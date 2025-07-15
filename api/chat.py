

import os
import base64
import re
import json
import logging
import requests  # <-- 新增：使用 requests 函式庫
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

from PIL import Image
import io

load_dotenv()
# --- 日誌：設定日誌格式，方便查看 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - IN_FUNCTION - %(message)s')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# --- Gemini API 設定 (保持不變) ---
gemini_api_key = os.getenv("GEMINI_API_KEY")
if not gemini_api_key:
    raise ValueError("請設定 GEMINI_API_KEY 環境變數")
genai.configure(api_key=gemini_api_key)

# --- SYSTEM_INSTRUCTION (保持不變) ---
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
    generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
)

# --- Azure Speech API 設定 (已修改) ---
# 我們不再需要建立 speech_config 物件，只需要從環境變數讀取金鑰和區域
speech_key = os.getenv("SPEECH_KEY")
speech_region = os.getenv("SPEECH_REGION")

if not (speech_key and speech_region):
    logging.warning("SPEECH_KEY 或 SPEECH_REGION 未設定，語音合成功能將被禁用。")

# --- 輔助函式 (保持不變) ---
def remove_emojis(text):
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F" "\U0001F300-\U0001F5FF" "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF" "\U00002600-\U000026FF" "\U00002700-\U000027BF"
        "\U0001F900-\U0001F9FF" "\U0001FA70-\U0001FAFF"
        "]+", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text).strip()

def process_history_for_gemini(history):
    processed_history = []
    for message in history:
        new_parts = []
        if not isinstance(message.get('parts'), list):
            continue
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

# --- 語音合成函式 (已完全重寫) ---
def text_to_speech_azure_batch(segments):
    if not (speech_key and speech_region):
        logging.warning("Azure Speech 未設定，跳過語音合成。")
        return None
        
    # 1. 建立 SSML (這部分邏輯與之前完全相同)
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

    if not ssml_fragments:
        return None
    final_ssml = f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='zh-TW'><voice name='zh-CN-YunxiNeural'>{''.join(ssml_fragments)}</voice></speak>"
    
    # 2. 設定 REST API 的請求參數
    endpoint = f"https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": speech_key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
        "User-Agent": "YoyoAI"
    }

    # 3. 發送請求並處理回應
    try:
        response = requests.post(endpoint, data=final_ssml.encode('utf-8'), headers=headers)
        if response.status_code == 200:
            # 成功取得音檔，將其編碼為 Base64
            return base64.b64encode(response.content).decode('utf-8')
        else:
            # 如果失敗，記錄下詳細錯誤以供排查
            logging.error(f"Azure 語音合成 API 錯誤: {response.status_code}")
            logging.error(f"錯誤訊息: {response.text}")
            return None
    except Exception as e:
        logging.error(f"呼叫 Azure TTS API 時發生未預期的錯誤: {e}")
        return None

# --- API Endpoint ---
@app.route('/api/chat', methods=['POST'])
def chat():
    # --- 日誌：這是最重要的日誌！如果我們看不到它，代表請求從未到達這裡 ---
    logging.critical("--- /chat ROUTE FUNCTION STARTED ---")
    
    try:
        # --- 日誌：查看收到的原始數據 ---
        raw_data = request.data
        logging.info(f"Received raw data: {raw_data[:200]}...") # 只顯示前200個字元以防過長
        
        data = request.json
        history = data.get("history", [])
        if not history:
            logging.error("Request rejected: history is empty.")
            return jsonify({"error": "歷史紀錄不可為空"}), 400

        # --- 日誌：顯示正在處理的對話歷史長度 ---
        logging.info(f"Processing history with {len(history)} entries.")
        
        gemini_history = process_history_for_gemini(history[:-1])
        latest_message_parts = process_history_for_gemini([history[-1]])[0]['parts']

        chat_session = model.start_chat(history=gemini_history)
        
        # --- 日誌：即將發送請求給 Gemini ---
        logging.info("Sending message to Gemini...")
        response = chat_session.send_message(latest_message_parts)
        logging.info("Received response from Gemini.")

        ai_segments = []
        text_for_display = ""
        try:
            clean_text = re.sub(r'^```json\s*|\s*```$', '', response.text.strip())
            response_data = json.loads(clean_text)
            if isinstance(response_data, list) and response_data:
                ai_segments = response_data
                text_for_display = " ".join([seg.get("text", "") for seg in ai_segments])
            else:
                raise ValueError("回應不是一個列表")
        except (json.JSONDecodeError, ValueError) as e:
            logging.warning(f"JSON 解析失敗: {e}. 將使用原始文字。")
            text_for_display = response.text
            ai_segments = [{"style": "default", "degree": 1.0, "rate": "0%", "pitch":"0%", "text": text_for_display}]

        # --- 日誌：準備進行語音合成 ---
        logging.info("Starting text-to-speech synthesis...")
        audio_content_base64 = text_to_speech_azure_batch(ai_segments)
        logging.info("Finished text-to-speech synthesis.")
        
        # --- 日誌：準備回傳最終結果 ---
        logging.critical("--- /chat ROUTE FUNCTION COMPLETED SUCCESSFULLY ---")
        return jsonify({
            "reply": text_for_display,
            "audio_content": audio_content_base64,
            "segments": ai_segments
        })

    except Exception as e:
        # --- 日誌：捕獲到未知錯誤 ---
        logging.critical(f"--- UNHANDLED EXCEPTION IN /chat ROUTE: {e} ---", exc_info=True)
        return jsonify({"error": "伺服器內部發生未知錯誤"}), 500

@app.route('/api/chat', methods=['GET'])
def api_root_health_check():
    # --- 日誌：用於測試 /api 根路徑是否可達 ---
    logging.info("--- / (GET) route was accessed ---")
    # 把回傳的訊息改成一個全新的、絕對不會搞混的訊息
    return "Python backend is alive and correctly routed!"