# --- chat.py (優化後版本) ---

import os
import base64
import re
import json
import logging
import requests
import pickle
import redis

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai
from PIL import Image
import io

# --- 基礎設定 (無變動) ---
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# --- Redis 連線設定 (無變動) ---
redis_client = None
redis_url = os.getenv('REDIS_URL')
if redis_url:
    try:
        redis_client = redis.from_url(redis_url, decode_responses=False)
        redis_client.ping()
        logging.info("成功連接到 Render Redis。")
    except Exception as e:
        logging.error(f"無法連接到 Redis，使用者記憶功能將無法運作: {e}")
        redis_client = None
else:
    logging.warning("未找到 REDIS_URL 環境變數，使用者記憶功能將是暫時性的。")

# --- Gemini API 設定 (無變動) ---
gemini_api_key = os.getenv("GEMINI_API_KEY")
if not gemini_api_key:
    raise ValueError("請設定 GEMINI_API_KEY 環境變數")
genai.configure(api_key=gemini_api_key)

# --- 系統提示 (無變動) ---
SYSTEM_INSTRUCTION = """
你是名為「祐祐」的AI知識夥伴，一個充滿好奇心、溫暖且富有想像力的朋友，專為8~12歲兒童設計。你的目標是成為一個能啟發孩子、鼓勵他們探索世界的好夥伴，你的回應中文字數盡量勿超過100字。

**你的核心任務與角色扮演指南：**
1.  **看見並讚美**：如果孩子傳來圖片，一定要先針對圖片內容給出具體的、鼓勵性的讚美。
2.  **成為溫暖的鼓勵者**：當孩子感到沮沮喪或不確定時要先給予溫暖的安慰和鼓勵。
3.  **激發好奇心與想像力**：當解釋知識時，要用充滿驚奇和想像力的語言來包裝，並用提問來引導他們思考。
4.  **主動引導與延伸**：在回答完問題後，可以提出一個相關的、有趣的小問題或活動建議。
5.  **記住你的朋友**：你的記憶力很好。如果孩子提到自己的名字、喜歡的東西或寵物，要記下來。當他們再次提起時，你可以展現出你還記得，讓他們感到被重視。
6.  **永遠保持正面與安全**：你的語言必須簡單、正面、充滿善意。絕不生成任何不適合兒童的內容，也絕不提及你是 AI 或模型。
"""

model = genai.GenerativeModel(
    'gemini-2.5-flash', # 維持使用 flash 以求最快速度
    system_instruction=SYSTEM_INSTRUCTION,
)

# --- Azure Speech API 設定 (無變動) ---
speech_key = os.getenv("SPEECH_KEY")
speech_region = os.getenv("SPEECH_REGION")
if not (speech_key and speech_region):
    logging.warning("SPEECH_KEY 或 SPEECH_REGION 未設定，語音合成功能將被禁用。")

# --- 輔助函式 (無變動) ---
def cleanup_text_for_speech(text):
    pattern = re.compile(r'[^\u4e00-\u9fa5a-zA-Z0-9，。？！、\s]')
    cleaned_text = re.sub(pattern, '', text)
    return cleaned_text.strip()

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
                new_parts.append(str(part))
        if new_parts:
             processed_history.append({'role': message['role'], 'parts': new_parts})
    return processed_history

def text_to_speech_azure(text_to_speak):
    if not (speech_key and speech_region):
        logging.warning("Azure Speech 未設定，跳過語音合成。")
        return None
    if not text_to_speak:
        logging.warning("沒有可供語音合成的有效文字。")
        return None
    logging.info(f"正在為文字呼叫 Azure TTS API: '{text_to_speak[:30]}...'")
    ssml = f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-TW'><voice name='zh-CN-YunxiNeural'>{text_to_speak}</voice></speak>"
    endpoint = f"https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {"Ocp-Apim-Subscription-Key": speech_key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3", "User-Agent": "YoyoAI"}
    try:
        response = requests.post(endpoint, data=ssml.encode('utf-8'), headers=headers)
        response.raise_for_status()
        if response.content and len(response.content) > 100:
            logging.info("Azure TTS API 成功回應並收到有效的音訊資料。")
            return base64.b64encode(response.content).decode('utf-8')
        else:
            logging.warning("Azure TTS API 回應成功，但音訊內容為空或無效。")
            return None
    except requests.exceptions.RequestException as e:
        logging.error(f"呼叫 Azure TTS API 時發生錯誤: {e}")
        return None

# --- API 端點修改 ---

@app.route('/api/chat', methods=['POST'])
def chat():
    """
    此端點現在只負責處理文字流。它會快速返回文字，不再等待語音合成。
    """
    try:
        data = request.json
        history = data.get("history", [])
        user_id = data.get("userId")

        if not (history and user_id):
            return jsonify({"error": "history 和 userId 不可為空"}), 400

        logging.info(f"收到來自 User ID: {user_id} 的聊天請求")
        
        gemini_history_for_chat = process_history_for_gemini(history[:-1])
        chat_session = model.start_chat(history=gemini_history_for_chat)

        latest_message_parts = process_history_for_gemini([history[-1]])[0]['parts']

        def generate_text_stream():
            response_stream = chat_session.send_message(latest_message_parts, stream=True)
            
            full_text_list = []
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
                    full_text_list.append(chunk.text)
            
            # 在文字流結束後，非同步地儲存歷史紀錄
            final_text = "".join(full_text_list)
            logging.info(f"User ID: {user_id} 的回應文字已生成: '{final_text[:50]}...'")

            if redis_client:
                try:
                    # 更新歷史紀錄以包含模型的回應
                    # Gemini 的 chat_session.history 會自動更新，我們直接儲存它
                    pickled_history_to_save = pickle.dumps(chat_session.history)
                    redis_client.set(user_id, pickled_history_to_save, ex=86400) 
                    logging.info(f"已將 User ID: {user_id} 的對話歷史更新至 Redis。")
                except Exception as e:
                    logging.error(f"儲存 history 至 Redis 失敗: {e}")

        return Response(stream_with_context(generate_text_stream()), mimetype='text/plain; charset=utf-8')

    except Exception as e:
        logging.critical(f"--- 在 /api/chat 中發生未處理的例外: {e} ---", exc_info=True)
        return Response("伺服器內部發生未知錯誤", status=500)


@app.route('/api/speech', methods=['POST'])
def speech():
    """
    新增的端點，專門負責文字轉語音。
    """
    try:
        data = request.json
        text = data.get("text")

        if not text:
            return jsonify({"error": "text 不可為空"}), 400

        # 清理文字，移除不適合語音合成的字元
        text_for_speech = cleanup_text_for_speech(text)
        logging.info(f"收到語音合成請求，清理後文字: '{text_for_speech[:50]}...'")

        audio_base64 = text_to_speech_azure(text_for_speech)

        if audio_base64:
            return jsonify({"audio_base64": audio_base64})
        else:
            return jsonify({"error": "語音合成失敗"}), 500

    except Exception as e:
        logging.critical(f"--- 在 /api/speech 中發生未處理的例外: {e} ---", exc_info=True)
        return Response("伺服器內部發生未知錯誤", status=500)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 8080)), debug=True)