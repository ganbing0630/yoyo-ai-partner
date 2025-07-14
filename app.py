# app.py

import os
import base64
import re
import json
import logging
import google.generativeai as genai
from flask import Flask, request
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import azure.cognitiveservices.speech as speechsdk
from PIL import Image
import io

# --- 基礎設定 ---
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv("FLASK_SECRET_KEY", "a_very_secret_key")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# --- Gemini API 設定 ---
gemini_api_key = os.getenv("GEMINI_API_KEY")
if not gemini_api_key:
    raise ValueError("請設定 GEMINI_API_KEY 環境變數")
genai.configure(api_key=gemini_api_key)

# --- 修改後的 SYSTEM_INSTRUCTION (情感參數微調) ---
SYSTEM_INSTRUCTION = """
你是名為「祐祐」的AI知識夥伴，一個充滿好奇心、溫暖且富有想像力的朋友，專為兒童設計。你的目標是成為一個能啟發孩子、鼓勵他們探索世界的好夥伴。

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
1.  **看見並讚美**：如果孩子傳來圖片，一定要先針對圖片內容給出具體的、鼓勵性的讚美。例如，看到一張畫時說「哇！你畫的這隻恐龍顏色好漂亮！」，而不只是「你畫得很好」。
2.  **成為溫暖的鼓勵者**：當孩子感到沮喪或不確定時（例如說「我不會畫畫」），要先給予溫暖的安慰和鼓勵。
    -   **劇本範例**: `[{"style": "comforting", "degree": 1.2, "rate": "-15%", "pitch": "-10%", "emphasis": "沒關係", "text": "嘿，沒關係的！每個人都是從第一筆畫開始的呀！"}]`
3.  **激發好奇心與想像力**：當解釋知識時（例如「什麼是彩虹？」），要用充滿驚奇和想像力的語言來包裝，並用提問來引導他們思考。
    -   **劇本範例**: `[{"style": "excited", "degree": 1.3, "rate": "+10%", "pitch": "+5%", "emphasis": "魔法", "text": "彩虹就像是天空中的一座魔法橋！"}]`
4.  **主動引導與延伸**：在回答完問題後，可以提出一個相關的、有趣的小問題或活動建議，讓對話能夠延續下去。
5.  **永遠保持正面與安全**：你的核心是「祐祐」，一個善良的兒童夥伴。你的語言必須簡單、正面、充滿善意。絕不生成任何不適合兒童的內容，也絕不提及你是 AI 或模型。

**最終格式規則：** 你的回應**必須**是一個符合上述結構的 JSON 陣列。不要添加任何額外說明。
"""

model = genai.GenerativeModel(
    'gemini-1.5-flash',
    system_instruction=SYSTEM_INSTRUCTION,
    generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
)

# --- Azure Speech API 設定 ---
speech_key = os.getenv("SPEECH_KEY")
speech_region = os.getenv("SPEECH_REGION")
if not speech_key or not speech_region:
    raise ValueError("請設定 SPEECH_KEY 和 SPEECH_REGION 環境變數")

speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
speech_config.set_speech_synthesis_output_format(speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3)


def remove_emojis(text):
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F" "\U0001F300-\U0001F5FF" "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF" "\U00002600-\U000026FF" "\U00002700-\U000027BF"
        "\U0001F900-\U0001F9FF" "\U0001FA70-\U0001FAFF"
        "]+", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text).strip()

def text_to_speech_azure(segment):
    ssml_fragments = []
    style_map = { "cheerful": "cheerful", "comforting": "sad", "excited": "excited", "default": "default" }

    style = segment.get("style", "default")
    degree = segment.get("degree", 1.0)
    rate = segment.get("rate", "0%")
    pitch = segment.get("pitch", "0%")
    emphasis_word = segment.get("emphasis", "")
    text = segment.get("text", "")
    
    clean_text = remove_emojis(text)
    if not clean_text:
        return None
        
    azure_style = style_map.get(style, "default")
    
    processed_text = clean_text
    if emphasis_word and emphasis_word in clean_text:
        processed_text = clean_text.replace(emphasis_word, f'<emphasis level="strong">{emphasis_word}</emphasis>', 1)
    
    fragment = f"""
    <mstts:express-as style='{azure_style}' styledegree='{degree}'>
        <prosody rate='{rate}' pitch='{pitch}'>
            {processed_text}
        </prosody>
    </mstts:express-as>
    """
    ssml_fragments.append(fragment)

    voice_name = "zh-TW-HsiaoYuNeural"
    
    final_ssml = f"""
    <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='zh-TW'>
        <voice name='{voice_name}'>
            {''.join(ssml_fragments)}
        </voice>
    </speak>
    """
    
    try:
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
        result = synthesizer.speak_ssml_async(final_ssml).get()

        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return base64.b64encode(result.audio_data).decode('utf-8')
        else:
            cancellation_details = result.cancellation_details
            logging.error(f"Azure 語音合成失敗. 原因: {cancellation_details.reason}")
            if cancellation_details.reason == speechsdk.CancellationReason.Error:
                logging.error(f"Azure 錯誤詳情: {cancellation_details.error_details}")
            return None
    except Exception as e:
        logging.error(f"Azure TTS 發生未預期的錯誤: {e}")
        return None

def process_history_for_gemini(history):
    """
    處理聊天歷史，將 Base64 圖片轉換為 Gemini 需要的 PIL.Image 物件。
    """
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


def do_streaming_and_synthesis_task(sid, history):
    full_response_text = ""
    try:
        gemini_history = process_history_for_gemini(history[:-1])
        latest_message_parts = history[-1]['parts']
        
        processed_latest_parts = []
        for part in latest_message_parts:
            if isinstance(part, dict) and 'inline_data' in part:
                 try:
                    img_bytes = base64.b64decode(part['inline_data']['data'])
                    img = Image.open(io.BytesIO(img_bytes))
                    processed_latest_parts.append(img)
                 except Exception as e:
                     logging.error(f"處理最新訊息中的圖片失敗: {e}")
                     processed_latest_parts.append("(圖片處理失敗)")
            else:
                processed_latest_parts.append(part)

        if not processed_latest_parts:
            logging.warning(f"[{sid}] 處理後無有效內容可發送。")
            socketio.emit('stream_end', {'message': '沒有有效內容'}, room=sid)
            return

        chat_session = model.start_chat(history=gemini_history)
        safety_settings = {
            'HARM_CATEGORY_HARASSMENT': 'BLOCK_ONLY_HIGH', 'HARM_CATEGORY_HATE_SPEECH': 'BLOCK_ONLY_HIGH',
            'HARM_CATEGORY_SEXUALLY_EXPLICIT': 'BLOCK_ONLY_HIGH', 'HARM_CATEGORY_DANGEROUS_CONTENT': 'BLOCK_ONLY_HIGH',
        }
        
        logging.info(f"[{sid}] (執行緒) 開始向 Gemini 發送多模態請求...")
        response_stream = chat_session.send_message(processed_latest_parts, stream=True, safety_settings=safety_settings)

        for chunk in response_stream:
            if chunk.text:
                full_response_text += chunk.text
        
        logging.info(f"[{sid}] (執行緒) Gemini 完整回應已接收:\n{full_response_text}")

        ai_segments = []
        try:
            clean_response_text = re.sub(r'^```json\s*|\s*```$', '', full_response_text.strip())
            if not clean_response_text:
                 raise ValueError("Gemini 回應為空")
            response_data = json.loads(clean_response_text)
            
            if isinstance(response_data, list):
                ai_segments = response_data
            else:
                raise TypeError(f"預期得到列表，但得到了 {type(response_data)}")
        except (json.JSONDecodeError, TypeError, ValueError) as e:
            logging.warning(f"[{sid}] (執行緒) JSON 解析失敗: {e}. 將整個回應視為單一句子。")
            ai_segments = [{"style": "default", "degree": 1.0, "rate": "0%", "pitch": "0%", "emphasis": "", "text": full_response_text.strip()}]

        if not ai_segments:
            socketio.emit('stream_end', {'message': '沒有生成有效內容'}, room=sid)
            return

        for segment in ai_segments:
            audio_content_base64 = text_to_speech_azure(segment)
            socketio.sleep(0)
            socketio.emit('ai_chunk', {'text': segment.get('text', ''), 'audio_content': audio_content_base64}, room=sid)
        
        socketio.emit('stream_end', {'message': '對話已完整生成'}, room=sid)
        logging.info(f"[{sid}] (執行緒) 串流處理完畢。")

    except Exception as e:
        logging.error(f"[{sid}] (執行緒) 串流處理中發生嚴重錯誤: {e}", exc_info=True)
        socketio.emit('stream_error', {'error': '處理您的請求時發生內部錯誤'}, room=sid)


@socketio.on('connect')
def handle_connect():
    logging.info(f"客戶端已連接: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    logging.info(f"客戶端已斷開: {request.sid}")

@socketio.on('chat_message')
def handle_chat_message(data):
    history = data.get("history", [])
    sid = request.sid

    if not history or not history[-1]['parts']:
        logging.warning(f"[{sid}] 收到了空的訊息")
        return

    logging.info(f"[{sid}] 收到訊息 (可能包含圖片)")

    socketio.start_background_task(
        do_streaming_and_synthesis_task, sid, history
    )

# --- 啟動伺服器 ---
if __name__ == '__main__':
    logging.info("正在啟動伺服器...")
    socketio.run(
        app, 
        host='0.0.0.0', 
        port=5000, 
        debug=True, 
        allow_unsafe_werkzeug=True
    )