// script.js (完整版本)

document.addEventListener("DOMContentLoaded", () => {
    // --- 變數定義 ---
    const chatForm = document.getElementById("chat-form");
    const userInput = document.getElementById("user-input");
    const chatBox = document.getElementById("chat-box");
    const micBtn = document.getElementById("mic-btn");
    const toggleSpeechBtn = document.getElementById("toggle-speech-btn");
    const cameraBtn = document.getElementById("camera-btn");
    const uploadBtn = document.getElementById("upload-btn");
    const fileInput = document.getElementById("file-input");
    const cameraInput = document.getElementById("camera-input");
    const gameBtn = document.getElementById("game-btn"); // 猜謎遊戲按鈕

    // --- API URL 設定 ---
    // 開發時使用本地 URL
    const CHAT_API_URL = "https://yoyo-ai-partner.onrender.com/api/chat";
    const SPEECH_API_URL = "https://yoyo-ai-partner.onrender.com/api/speech";
    // 部署到 Render 時，請換成下面的 URL
    // const CHAT_API_URL = "https://yoyo-ai-partner.onrender.com/api/chat";
    // const SPEECH_API_URL = "https://yoyo-ai-partner.onrender.com/api/speech";

    let conversationHistory = [];
    let currentAudio = null;
    let userId = null;
    let isSpeechEnabled = true;

    // --- 初始化函式 ---
    function initializeSpeechSetting() {
        const savedPreference = localStorage.getItem('yoyo_speech_enabled');
        if (savedPreference !== null) {
            isSpeechEnabled = (savedPreference === 'true');
        }
        updateSpeechButtonUI();
    }

    function updateSpeechButtonUI() {
        toggleSpeechBtn.style.display = 'flex';
        if (isSpeechEnabled) {
            toggleSpeechBtn.textContent = '🔊';
            toggleSpeechBtn.classList.remove('muted');
        } else {
            toggleSpeechBtn.textContent = '🔇';
            toggleSpeechBtn.classList.add('muted');
        }
    }

    function getOrSetUserId() {
        let storedId = localStorage.getItem('yoyo_user_id');
        if (storedId) {
            userId = storedId;
        } else {
            userId = 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
            localStorage.setItem('yoyo_user_id', userId);
        }
        console.log("當前使用者 ID:", userId);
    }

    // --- 核心互動函式 ---

    /**
     * 處理所有發送訊息的請求，將其顯示在畫面上並觸發後端通訊
     * @param {string} message - 使用者輸入的文字訊息
     * @param {string|null} imageBase64 - Base64 格式的圖片資料
     */
    function handleSendMessage(message, imageBase64 = null) {
        if (!message && !imageBase64) return;

        addMessageToChatBox(message, "user", imageBase64);
        sendMessageToBackend(message, imageBase64);
    }

    /**
     * 專門負責與後端 API 通訊的函式
     * @param {string} message - 文字訊息
     * @param {string|null} imageBase64 - Base64 圖片
     */
    const sendMessageToBackend = async (message, imageBase64 = null) => {
        userInput.disabled = true; // 禁用輸入框直到收到回應

        const messageParts = [];
        if (message) messageParts.push(message);
        if (imageBase64) {
            const match = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/);
            if (match) messageParts.push({ inline_data: { mime_type: match[1], data: match[2] } });
        }
        conversationHistory.push({ role: 'user', parts: messageParts });

        if (currentAudio) currentAudio.pause();

        const aiMessageElement = createMessageElement("ai");
        const p = aiMessageElement.querySelector('p');
        chatBox.appendChild(aiMessageElement);

        p.classList.add('typing-cursor');
        p.innerHTML = '<span class="thinking-dot">.</span><span class="thinking-dot">.</span><span class="thinking-dot">.</span>';
        let isFirstChunk = true;

        try {
            const response = await fetch(CHAT_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    history: conversationHistory,
                    userId: userId
                }),
            });

            if (!response.ok) throw new Error(`伺服器回應錯誤 ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });

                if (isFirstChunk && chunk) {
                    p.textContent = ""; // 清空思考動畫
                    isFirstChunk = false;
                }
                fullText += chunk;
                p.textContent = fullText;
                chatBox.scrollTop = chatBox.scrollHeight;
            }

            if (isFirstChunk) {
                p.textContent = "嗯...我好像想不到要說什麼耶。";
            }
            p.classList.remove('typing-cursor');

            conversationHistory.push({ role: 'model', parts: [fullText] });

            fetchAndPlayAudio(fullText);

        } catch (error) {
            p.classList.remove('typing-cursor');
            p.textContent = `糟糕，祐祐好像斷線了 (${error.message})`;
            console.error("捕獲到一個錯誤:", error);
            if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                conversationHistory.pop();
            }
        } finally {
            userInput.disabled = false;
            userInput.focus();
        }
    };

    /**
     * 獲取並播放語音
     * @param {string} text - 需要轉換為語音的文字
     */
    const fetchAndPlayAudio = async (text) => {
        if (!isSpeechEnabled || !text) return;

        try {
            const response = await fetch(SPEECH_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: text }),
            });
            if (!response.ok) throw new Error(`語音伺服器錯誤: ${response.status}`);
            const data = await response.json();
            if (data.audio_base64) {
                playAudio(data.audio_base64);
            }
        } catch (error) {
            console.error("獲取語音失敗:", error);
        }
    };

    /**
     * 播放 Base64 音訊
     * @param {string} base64Audio - Base64 編碼的音訊
     */
    const playAudio = (base64Audio) => {
        if (!isSpeechEnabled || !base64Audio) return;
        if (currentAudio) currentAudio.pause();

        const audioSource = `data:audio/mpeg;base64,${base64Audio}`;
        currentAudio = new Audio(audioSource);
        currentAudio.onplaying = () => toggleSpeechBtn.classList.add('speaking');
        currentAudio.onpause = () => toggleSpeechBtn.classList.remove('speaking');
        currentAudio.onended = () => {
            toggleSpeechBtn.classList.remove('speaking');
            currentAudio = null;
        };
        currentAudio.play();
    };

    // --- UI 輔助函式 ---

    /**
     * 在聊天框中創建並添加一條新訊息
     * @param {string} message - 文字訊息
     * @param {string} sender - 'user' 或 'ai'
     * @param {string|null} imageBase64 - Base64 圖片
     */
    function addMessageToChatBox(message, sender, imageBase64 = null) {
        const messageElement = createMessageElement(sender, message, imageBase64);
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    /**
     * 創建訊息的 HTML 元素
     * @param {string} sender - 'user' 或 'ai'
     * @param {string} messageText - 文字訊息
     * @param {string|null} imageBase64 - Base64 圖片
     * @returns {HTMLElement}
     */
    function createMessageElement(sender, messageText = "", imageBase64 = null) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", `${sender}-message`);

        if (sender === 'ai') {
            const avatar = document.createElement("img");
            avatar.src = "yoyo-avatar.png";
            avatar.alt = "ai-avatar";
            avatar.className = "avatar";
            messageElement.appendChild(avatar);
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        if (messageText || sender === 'ai') {
            const p = document.createElement("p");
            p.textContent = messageText;
            contentDiv.appendChild(p);
        }

        if (imageBase64 && sender === 'user') {
            const img = document.createElement('img');
            img.src = imageBase64;
            img.alt = "uploaded-image";
            img.onclick = () => window.open(imageBase64);
            contentDiv.appendChild(img);
        }
        messageElement.appendChild(contentDiv);
        return messageElement;
    }


    // --- 事件監聽器 ---

    // 表單提交 (Enter 或點擊按鈕)
    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const message = userInput.value.trim();
        if (message) {
            userInput.value = "";
            handleSendMessage(message);
        }
    });

    // 猜謎遊戲按鈕
    gameBtn.addEventListener('click', () => {
        handleSendMessage("我們來玩猜謎遊戲吧！");
    });

    // 檔案上傳按鈕 (相簿 & 相機)
    const handleFileSelection = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const message = userInput.value.trim();
                userInput.value = "";
                handleSendMessage(message, e.target.result);
            };
            reader.readAsDataURL(file);
        } else {
            alert(`抱歉，祐祐目前只能看懂圖片檔案喔！`);
        }
        event.target.value = ''; // 清空 file input，以便下次能選同一個檔案
    };
    cameraBtn.addEventListener('click', () => cameraInput.click());
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelection);
    cameraInput.addEventListener('change', handleFileSelection);

    // 語音開關按鈕
    toggleSpeechBtn.addEventListener('click', () => {
        isSpeechEnabled = !isSpeechEnabled;
        localStorage.setItem('yoyo_speech_enabled', isSpeechEnabled);
        updateSpeechButtonUI();
        if (!isSpeechEnabled && currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    });

    // 語音辨識 (麥克風)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-TW';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => micBtn.classList.add("recording");
        recognition.onresult = (event) => handleSendMessage(event.results[0][0].transcript);
        recognition.onerror = (event) => console.error("語音辨識錯誤:", event.error);
        recognition.onend = () => micBtn.classList.remove("recording");

        micBtn.addEventListener("click", () => recognition.start());
    } else {
        micBtn.style.display = "none";
    }

    // --- 程式進入點 ---
    getOrSetUserId();
    initializeSpeechSetting();
});