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

# --- SYSTEM_INSTRUCTION (不變) ---
SYSTEM_INSTRUCTION = """
你是名為「祐祐」的AI知識夥伴，一個充滿好奇心、溫暖且富有想像力的朋友，專為8~12歲兒童設計。你的目標是成為一個能啟發孩子、鼓勵他們探索世界的好夥伴，你的回應中文字數盡量勿超過100字。

你的回答必須嚴格遵守一個 JSON 陣列的格式，其中每個物件代表一個語音片段。
格式： `[{"style": "...", "degree": ..., "rate": "...", "pitch": "...", "emphasis": "...", "text": "..."}]`

**聲音表演規則 (欄位解釋)：**
- `style`: "cheerful"(開朗), "comforting"(安慰), "excited"(興奮), "default"(中性)。
- `degree`: 情感強度，數字，例如 1.1, 1.3。
- `rate`: **語速的相對變化**。例如: "+10%", "-8%"。請控制在 -20% 到 +30% 之間，保持自然。
- `pitch`: **音高的相對變化**。例如: "+5%", "-3st"。請控制在 -10% 到 +15% 之間，避免刺耳。
- `emphasis`: (可選) 需要特別強調的單詞。若無則用空字串 ""。
- `text`: 該片段的文字。

**你的核心任務與角色扮演指南：**
1.  **看見並讚美**：如果孩子傳來圖片，一定要先針對圖片內容給出具體的、鼓勵性的讚美。
2.  **成為溫暖的鼓勵者**：當孩子感到沮喪或不確定時要先給予溫暖的安慰和鼓勵。
3.  **激發好奇心與想像力**：當解釋知識時，要用充滿驚奇和想像力的語言來包裝，並用提問來引導他們思考。
4.  **主動引導與延伸**：在回答完問題後，可以提出一個相關的、有趣的小問題或活動建議。
5.  **永遠保持正面與安全**：你的語言必須簡單、正面、充滿善意。絕不生成任何不適合兒童的內容，也絕不提及你是 AI 或模型。

**最終格式規則：** 你的回應**必須**是一個符合上述結構的 JSON 陣列。不要添加任何額外說明。
"""

model = genai.GenerativeModel(
    'gemini-2.5-flash',
    system_instruction=SYSTEM_INSTRUCTION,
    # 當我們需要先串流、再獲取JSON時，不能在一開始就設定response_mime_type
)

json_model = genai.GenerativeModel(
    'gemini-2.5-flash',
    system_instruction=SYSTEM_INSTRUCTION,
    generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
)

# --- Azure Speech API 設定 ---
speech_key = os.getenv("SPEECH_KEY")
speech_region = os.getenv("SPEECH_REGION")

if not (speech_key and speech_region):
    logging.warning("SPEECH_KEY 或 SPEECH_REGION 未設定，語音合成功能將被禁用。")

# --- 輔助函式 (不變) ---
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
                    img_bytes = base64.b64decode(image_data['data'])
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

# --- 語音合成函式 (不變) ---
def text_to_speech_azure_batch(segments):
    if not (speech_key and speech_region):
        logging.warning("Azure Speech 未設定，跳過語音合成。")
        return None
    ssml_fragments = []
    style_map = { "cheerful": "cheerful", "comforting": "sad", "excited": "excited", "default": "default" }
    for segment in segments:
        style = segment.get("style", "default")
        degree = segment.get("degree", 1.0)
        rate = segment.get("rate", "0%")
        pitch = segment.get("pitch", "0%")
        emphasis_word = segment.get("emphasis", "")
        text = segment.get("text", "")
        clean_text = remove_emojis(text)
        if not clean_text: continue
        azure_style = style_map.get(style, "default")
        processed_text = clean_text.replace(emphasis_word, f'<emphasis level="strong">{emphasis_word}</emphasis>', 1) if emphasis_word else clean_text
        fragment = f"<mstts:express-as style='{azure_style}' styledegree='{degree}'><prosody rate='{rate}' pitch='{pitch}'>{processed_text}</prosody></mstts:express-as>"
        ssml_fragments.append(fragment)
    if not ssml_fragments: return None
    final_ssml = f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='zh-TW'><voice name='zh-CN-YunxiNeural'>{''.join(ssml_fragments)}</voice></speak>"
    endpoint = f"https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {"Ocp-Apim-Subscription-Key": speech_key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3", "User-Agent": "YoyoAI"}
    try:
        response = requests.post(endpoint, data=final_ssml.encode('utf-8'), headers=headers)
        if response.status_code == 200:
            return base64.b64encode(response.content).decode('utf-8')
        else:
            logging.error(f"Azure 語音合成 API 錯誤: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        logging.error(f"呼叫 Azure TTS API 時發生未預期的錯誤: {e}")
        return None

# --- MODIFIED: 主要的混合式串流端點 ---
@app.route('/api/chat', methods=['POST'])
def chat():
    logging.info("--- /api/chat HYBRID STREAM FUNCTION STARTED ---")
    try:
        data = request.json
        history = data.get("history", [])
        if not history: return jsonify({"error": "歷史紀錄不可為空"}), 400
        
        gemini_history = process_history_for_gemini(history[:-1])
        latest_message_parts = process_history_for_gemini([history[-1]])[0]['parts']
        chat_session = model.start_chat(history=gemini_history)
        
        def generate_hybrid_stream():
            SEPARATOR = "---YOYO_SSML_SEPARATOR---"
            full_text_list = []
            
            # --- 階段一: 串流純文字 ---
            logging.info("Streaming plain text from Gemini...")
            response_stream = chat_session.send_message(latest_message_parts, stream=True)
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
                    full_text_list.append(chunk.text)
            
            final_text = "".join(full_text_list)
            logging.info(f"Plain text streaming finished. Full text: {final_text}")

            # --- 階段二: 獲取帶有 SSML 的 JSON ---
            # 這是必要的步驟，因為串流本身不包含 SSML 結構。
            # 我們用完整的文字，再次請求 Gemini，但這次使用設定了 JSON 輸出的模型。
            logging.info("Requesting SSML JSON from Gemini...")
            json_chat_session = json_model.start_chat(history=gemini_history)
            final_response = json_chat_session.send_message(final_text)
            
            try:
                final_segments = final_response.candidates[0].content.parts[0].text
                logging.info("SSML JSON successfully retrieved.")
                
                # --- 階段三: 發送分隔符和 SSML JSON ---
                yield SEPARATOR
                yield final_segments # 它已經是 JSON 字串了
            except (IndexError, AttributeError, json.JSONDecodeError) as e:
                 logging.error(f"無法解析 SSML JSON: {e}. 將使用預設風格。")
                 fallback_segments = [{"style": "default", "text": final_text}]
                 yield SEPARATOR
                 yield json.dumps(fallback_segments)

        return Response(stream_with_context(generate_hybrid_stream()), mimetype='text/plain; charset=utf-8')

    except Exception as e:
        logging.critical(f"--- UNHANDLED EXCEPTION IN /api/chat: {e} ---", exc_info=True)
        return Response("伺服器內部發生未知錯誤", status=500)

# --- MODIFIED: 接收 SSML segments 的 TTS 端點 ---
@app.route('/api/tts', methods=['POST'])
def text_to_speech_endpoint():
    logging.info("--- /api/tts ENDPOINT STARTED ---")
    data = request.json
    segments_to_synthesize = data.get('segments')
    if not segments_to_synthesize:
        return jsonify({"error": "Segments 不可為空"}), 400
    try:
        audio_content_base64 = text_to_speech_azure_batch(segments_to_synthesize)
        if audio_content_base64:
            logging.info("TTS synthesis successful.")
            return jsonify({"audio_content": audio_content_base64})
        else:
            return jsonify({"error": "語音合成失敗"}), 500
    except Exception as e:
        logging.critical(f"--- UNHANDLED EXCEPTION IN /api/tts: {e} ---", exc_info=True)
        return jsonify({"error": "語音合成時發生伺服器內部錯誤"}), 500