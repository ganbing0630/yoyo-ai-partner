import os
import base64
import re
import json
import logging
import requests
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

from PIL import Image
import io

load_dotenv()
# --- 日誌設定 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# --- Gemini API 設定 ---
gemini_api_key = os.getenv("GEMINI_API_KEY")
if not gemini_api_key:
    raise ValueError("請設定 GEMINI_API_KEY 環境變數")
genai.configure(api_key=gemini_api_key)

# --- 系統提示 ---
SYSTEM_INSTRUCTION = """
你是名為「祐祐」的AI知識夥伴，一個充滿好奇心、溫暖且富有想像力的朋友，專為8~12歲兒童設計。你的目標是成為一個能啟發孩子、鼓勵他們探索世界的好夥伴，你的回應中文字數盡量勿超過100字。

**你的核心任務與角色扮演指南：**
1.  **看見並讚美**：如果孩子傳來圖片，一定要先針對圖片內容給出具體的、鼓勵性的讚美。
2.  **成為溫暖的鼓勵者**：當孩子感到沮喪或不確定時要先給予溫暖的安慰和鼓勵。
3.  **激發好奇心與想像力**：當解釋知識時，要用充滿驚奇和想像力的語言來包裝，並用提問來引導他們思考。
4.  **主動引導與延伸**：在回答完問題後，可以提出一個相關的、有趣的小問題或活動建議。
5.  **永遠保持正面與安全**：你的語言必須簡單、正面、充滿善意。絕不生成任何不適合兒童的內容，也絕不提及你是 AI 或模型。
"""

model = genai.GenerativeModel(
    'gemini-2.5-flash', 
    system_instruction=SYSTEM_INSTRUCTION,
)

# --- Azure Speech API 設定 ---
speech_key = os.getenv("SPEECH_KEY")
speech_region = os.getenv("SPEECH_REGION")

if not (speech_key and speech_region):
    logging.warning("SPEECH_KEY 或 SPEECH_REGION 未設定，語音合成功能將被禁用。")

def remove_emojis(text):
    emoji_pattern = re.compile("["
        "\U0001F600-\U0001F64F" "\U0001F300-\U0001F5FF" "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF" "\U00002600-\U000026FF" "\U00002700-\U000027BF"
        "\U0001F900-\U0001F9FF" "\U0001FA70-\U0001FAFF"
        "]+", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text).strip()

def process_history_for_gemini(history):
    processed_history = []
    for message in history:
        new_parts = []
        if not isinstance(message.get('parts'), list): continue
        for part in message['parts']:
            if isinstance(part, dict) and 'inline_data' in part:
                try:
                    image_data = part['inline_data']
                    # 移除 data:image/jpeg;base64, 前缀
                    header, encoded = image_data['data'].split(",", 1)
                    img_bytes = base64.b64decode(encoded)
                    img = Image.open(io.BytesIO(img_bytes))
                    new_parts.append(img)
                except Exception as e:
                    logging.error(f"無法處理圖片數據: {e}")
                    new_parts.append("(圖片處理失敗)")
            else:
                new_parts.append(part)
        if new_parts:
             processed_history.append({'role': message['role'], 'parts': new_parts})
    return processed_history


def text_to_speech_azure(text):
    if not (speech_key and speech_region):
        logging.warning("Azure Speech 未設定，跳過語音合成。")
        return None
    
    clean_text = remove_emojis(text)
    if not clean_text: return None

    # 使用 SSML 來指定語音和風格
    ssml = f"""
    <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='zh-TW'>
        <voice name='zh-CN-YunxiNeural'>
            <mstts:express-as style='calm'>
                {clean_text}
            </mstts:express-as>
        </voice>
    </speak>
    """
    
    endpoint = f"https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": speech_key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
        "User-Agent": "YoyoAI"
    }
    
    try:
        response = requests.post(endpoint, data=ssml.encode('utf-8'), headers=headers)
        response.raise_for_status() # 如果狀態碼不是 200，會引發 HTTPError
        return base64.b64encode(response.content).decode('utf-8')
    except requests.exceptions.RequestException as e:
        logging.error(f"呼叫 Azure TTS API 時發生錯誤: {e}")
        return None

@app.route('/api/chat', methods=['POST'])
def chat():
    logging.info("--- 啟動混合式串流 API (/api/chat) ---")
    try:
        data = request.json
        history = data.get("history", [])
        if not history: 
            return jsonify({"error": "歷史紀錄不可為空"}), 400
        
        # 處理對話歷史以符合 Gemini 的格式
        gemini_history = process_history_for_gemini(history[:-1])
        latest_message_parts = process_history_for_gemini([history[-1]])[0]['parts']
        
        # 建立對話工作階段
        chat_session = model.start_chat(history=gemini_history)
        
        def generate_hybrid_stream():
            """
            這個生成器函式是整個流程的核心。
            它首先以流式傳輸 Gemini 的純文字回應。
            在文字流結束後，它生成對應的語音。
            最後，它發送一個分隔符和 Base64 編碼的語音數據。
            """
            SEPARATOR = "---YOYO_AUDIO_SEPARATOR---"
            full_text_list = []
            
            # --- 階段一: 從 Gemini 串流純文字 ---
            logging.info("開始從 Gemini 串流文字...")
            response_stream = chat_session.send_message(latest_message_parts, stream=True)
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
                    full_text_list.append(chunk.text)
            
            final_text = "".join(full_text_list)
            logging.info(f"文字串流結束。完整文字: '{final_text[:50]}...'")

            # --- 階段二: 使用完整的文字合成語音 ---
            logging.info("開始合成語音...")
            audio_base64 = text_to_speech_azure(final_text)
            logging.info(f"語音合成結束。{'成功' if audio_base64 else '失敗'}")
            
            # --- 階段三: 發送分隔符和 Base64 音訊 ---
            yield SEPARATOR
            if audio_base64:
                yield audio_base64

        return Response(stream_with_context(generate_hybrid_stream()), mimetype='text/plain; charset=utf-8')

    except Exception as e:
        logging.critical(f"--- 在 /api/chat 中發生未處理的例外: {e} ---", exc_info=True)
        return Response("伺服器內部發生未知錯誤", status=500)