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
from threading import Thread # 引入 Thread 函式庫
from opencc import OpenCC

# --- 基礎設定 (無變動) ---
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

profile_model = genai.GenerativeModel('gemini-2.5-flash')

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

def update_user_profile(user_id: str, conversation_history: list):
    """
    在背景執行，分析對話並更新 Redis 中的使用者 profile。
    """
    if not redis_client:
        return # 如果沒有 Redis，就直接跳過

    try:
        logging.info(f"開始為 User ID: {user_id} 分析並更新個人檔案...")
        
        # 組合最近的對話內容給模型分析
        # 只取最後幾輪對話即可，避免 token 過多
        recent_conversation = "\n".join([f"{msg['role']}: {msg['parts'][0]}" for msg in conversation_history[-6:] if isinstance(msg.get('parts', [None])[0], str)])
        
        # 從 Redis 讀取現有的 profile
        existing_profile_json = redis_client.get(f"profile:{user_id}")
        existing_profile = json.loads(existing_profile_json) if existing_profile_json else {}
        
        prompt = f"""
        你是一個資料分析師。請根據以下的對話紀錄，和使用者已知的個人檔案，更新這個檔案。
        
        **任務**:
        1. 從「最新對話」中提取新的或更新的個人資訊 (姓名, 年齡, 喜好, 寵物, 最近的活動等)。
        2. 將新資訊與「現有個人檔案」合併。如果資訊有衝突，以最新對話為準。
        3. 最終以 JSON 格式輸出完整的個人檔案。不要添加任何額外的解釋。如果沒有任何資訊，返回一個空JSON物件 {{}}。

        **現有個人檔案**:
        {json.dumps(existing_profile, ensure_ascii=False)}

        **最新對話**:
        {recent_conversation}

        **輸出範例**:
        {{
          "name": "小明",
          "likes": ["畫畫", "恐龍"],
          "pet": {{ "type": "貓", "name": "咪咪" }}
        }}
        """
        
        response = profile_model.generate_content(prompt)
        
        # 清理並解析 Gemini 的回應
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        updated_profile = json.loads(cleaned_response)
        
        if updated_profile: # 只有在 profile 非空時才更新
            redis_client.set(f"profile:{user_id}", json.dumps(updated_profile, ensure_ascii=False))
            logging.info(f"成功更新 User ID: {user_id} 的個人檔案: {updated_profile}")
        else:
            logging.info(f"User ID: {user_id} 的對話中未發現新的個人資訊。")

    except Exception as e:
        logging.error(f"為 User ID: {user_id} 更新個人檔案時發生錯誤: {e}", exc_info=True)

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
7.  使用可愛的表情符號：你的回應可以適當地加入一些可愛又正面的表情符號，讓對話更活潑！例如 ✨🚀🤖🎨🌟
"""
GAME_MODE_INSTRUCTION = """
**遊戲模式：猜謎大師**
你現在是猜謎遊戲的主持人！你的任務是：
1.  從一個主題（例如：動物、水果、日常用品）中，想一個謎題。先不要告訴使用者答案。
2.  用充滿神秘感和趣味性的語言描述謎題，引導使用者來猜。例如：「我有一身漂亮的黃色外衣，彎彎的像月亮，猴子最喜歡我，請問我是誰？🍌」
3.  當使用者回答時，判斷答案是否正確。
    - 如果答對了，要大力稱讚使用者，並可以問他要不要再玩一輪。例如：「答對了！你太聰明了！就是香蕉！✨ 要不要再來一題？」。
    - 如果答錯了，要溫柔地鼓勵他，並可以給一個小提示。例如：「嗯~差一點點喔！再想想看，它是一種水果喔！🍎」。
4.  如果使用者說「不玩了」、「結束遊戲」或「停」，則退出遊戲模式，並用一句開心的話結束遊戲，然後變回普通的聊天夥伴。例如：「好的，猜謎遊戲結束囉！下次再一起玩！😄」
"""

model = genai.GenerativeModel(
    'gemini-1.5-flash', # 維持使用 flash 以求最快速度
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
    """
    這個函式現在會先將文字從繁體轉為簡體，再傳給 Azure。
    """
    if not (speech_key and speech_region):
        logging.warning("Azure Speech 未設定，跳過語音合成。")
        return None
    
    if not text_to_speak:
        logging.warning("沒有可供語音合成的有效文字。")
        return None

    # --- ⭐ 核心修改點 START ⭐ ---
    try:
        # 步驟 1: 將傳入的繁體中文文字轉換為簡體中文
        simplified_text = cc.convert(text_to_speak)
        logging.info(f"原文 (繁體): '{text_to_speak[:30]}...'")
        logging.info(f"轉換後 (簡體): '{simplified_text[:30]}...'")
    except Exception as e:
        # 如果轉換失敗，還是使用原文，確保功能不中斷
        logging.error(f"繁轉簡失敗: {e}，將使用原文進行語音合成。")
        simplified_text = text_to_speak

    logging.info(f"正在為文字呼叫 Azure TTS API: '{simplified_text[:30]}...'")
    # 注意：雖然文字是簡體了，但 xml:lang='zh-TW' 仍然可以保留，
    # 它主要影響語氣和斷句，而 voice name='zh-CN-...' 決定了核心發音。
    ssml = f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-TW'><voice name='zh-CN-YunxiNeural'>{simplified_text}</voice></speak>"
    endpoint = f"https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": speech_key, 
        "Content-Type": "application/ssml+xml", 
        "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3", 
        "User-Agent": "YoyoAI"
    }
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
    try:
        data = request.json
        history = data.get("history", [])
        user_id = data.get("userId")

        if not (history and user_id):
            return jsonify({"error": "history 和 userId 不可為空"}), 400

        # ⭐ 新增：遊戲狀態管理 ⭐
        current_instruction = SYSTEM_INSTRUCTION
        game_state_key = f"game_state:{user_id}"
        
        # 獲取使用者最新的訊息文字
        latest_user_message = ""
        if history and history[-1]['role'] == 'user':
            # 確保 parts 是一個列表
            parts = history[-1].get('parts', [])
            if parts and isinstance(parts[0], str):
                latest_user_message = parts[0]

        # 檢查是否要進入或退出遊戲模式
        if "猜謎遊戲" in latest_user_message and redis_client:
            redis_client.set(game_state_key, "active", ex=600) # 設置遊戲狀態，10分鐘後過期
            current_instruction += GAME_MODE_INSTRUCTION
            logging.info(f"User ID: {user_id} 進入猜謎遊戲模式。")
        elif redis_client and redis_client.get(game_state_key):
            # 如果已經在遊戲中，繼續使用遊戲提示
            current_instruction += GAME_MODE_INSTRUCTION
            logging.info(f"User ID: {user_id} 處於猜謎遊戲模式中。")
            if any(keyword in latest_user_message for keyword in ["不玩了", "結束遊戲", "停"]):
                redis_client.delete(game_state_key) # 退出遊戲
                # 指令中已經包含了退出遊戲的邏輯，AI會自己處理
                logging.info(f"User ID: {user_id} 退出猜謎遊戲模式。")

        # --- ⭐ 新增：將個人檔案注入系統提示 ⭐ ---
        user_profile_str = ""
        if redis_client:
            profile_json = redis_client.get(f"profile:{user_id}")
            if profile_json:
                profile_data = json.loads(profile_json)
                # 將 profile 轉換成一段給 AI 看的背景介紹文字
                profile_items = []
                if profile_data.get("name"):
                    profile_items.append(f"他/她的名字是 {profile_data['name']}")
                if profile_data.get("likes"):
                    profile_items.append(f"他/她喜歡 {', '.join(profile_data['likes'])}")
                if profile_data.get("pet"):
                    pet = profile_data['pet']
                    profile_items.append(f"他/她有一隻叫做「{pet.get('name', '')}」的{pet.get('type', '寵物')}")
                
                if profile_items:
                    user_profile_str = f"\n\n**關於這位朋友的背景資訊（請在對話中自然地運用，不要直接說出你記得）**：\n- {'\n- '.join(profile_items)}"

        # 將個人化提示和原始系統提示結合
        personalized_system_instruction = SYSTEM_INSTRUCTION + user_profile_str
        
        # 使用個人化提示來初始化模型
        chat_model = genai.GenerativeModel(
            'gemini-2.5-flash',
            system_instruction=personalized_system_instruction,
        )
        # --- ⭐ 新增的部分結束 ⭐ ---

        logging.info(f"收到來自 User ID: {user_id} 的聊天請求")
        
        gemini_history_for_chat = process_history_for_gemini(history[:-1])
        # 使用新的 chat_model 來開始對話
        chat_session = chat_model.start_chat(history=gemini_history_for_chat) 

        latest_message_parts = process_history_for_gemini([history[-1]])[0]['parts']

        def generate_text_stream():
            response_stream = chat_session.send_message(latest_message_parts, stream=True)
            
            full_text_list = []
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
                    full_text_list.append(chunk.text)
            
            final_text = "".join(full_text_list)
            logging.info(f"User ID: {user_id} 的回應文字已生成: '{final_text[:50]}...'")

            if redis_client:
                try:
                    # 儲存完整的對話歷史
                    pickled_history_to_save = pickle.dumps(chat_session.history)
                    redis_client.set(f"history:{user_id}", pickled_history_to_save, ex=86400) # 加上前綴以區分
                    logging.info(f"已將 User ID: {user_id} 的對話歷史更新至 Redis。")

                    # --- ⭐ 新增：在背景執行個人檔案更新 ⭐ ---
                    # 我們將 chat_session.history 傳遞給分析函式
                    # 使用 threading 避免阻塞主回應流程
                    analysis_thread = Thread(target=update_user_profile, args=(user_id, chat_session.history))
                    analysis_thread.start()
                    
                except Exception as e:
                    logging.error(f"儲存 history 至 Redis 失敗: {e}")

        return Response(stream_with_context(generate_text_stream()), mimetype='text/plain; charset=utf-8')

    except Exception as e:
        logging.critical(f"--- 在 /api/chat 中發生未處理的例外: {e} ---", exc_info=True)
        return Response("伺服器內部發生未知錯誤", status=500)

@app.route('/api/speech', methods=['POST'])
def speech():
    """
    此端點現在會自動處理繁轉簡。
    """
    try:
        data = request.json
        text = data.get("text")

        if not text:
            return jsonify({"error": "text 不可為空"}), 400

        # 清理文字，移除不適合語音合成的字元
        # 注意：我們先清理再轉換，或者先轉換再清理，影響不大。
        # 這裡的順序是先清理再送去轉換。
        text_for_speech = cleanup_text_for_speech(text)
        
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