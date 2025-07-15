// script.js (已修正)
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

    const CHAT_API_URL = "/api/chat";

    let conversationHistory = [];
    let currentAudio = null;
    let userId = null;
    
    // 1. 新增聲音狀態變數，預設為開啟
    let isSpeechEnabled = true;

    // 2. 新增函式：初始化聲音設定，從 localStorage 讀取使用者偏好
    function initializeSpeechSetting() {
        const savedPreference = localStorage.getItem('yoyo_speech_enabled');
        if (savedPreference !== null) {
            // localStorage 儲存的是字串，需轉換為布林值
            isSpeechEnabled = (savedPreference === 'true');
        }
        updateSpeechButtonUI(); // 根據讀取的設定更新按鈕外觀
    }

    // 3. 新增函式：專門用來更新聲音按鈕的 UI
    function updateSpeechButtonUI() {
        // 讓按鈕永遠顯示
        toggleSpeechBtn.style.display = 'flex'; 
        if (isSpeechEnabled) {
            toggleSpeechBtn.textContent = '🔊';
            toggleSpeechBtn.classList.remove('muted'); // 移除靜音樣式
        } else {
            toggleSpeechBtn.textContent = '🔇';
            toggleSpeechBtn.classList.add('muted'); // 增加靜音樣式
        }
    }
    
    // --- 使用者ID管理 ---
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
    
    // --- 頁面載入時初始化 ---
    getOrSetUserId();
    initializeSpeechSetting(); // 頁面載入時就執行聲音初始化

    // --- 檔案/相機上傳 ---
    cameraBtn.addEventListener('click', () => cameraInput.click());
    uploadBtn.addEventListener('click', () => fileInput.click());
    
    const handleFileSelection = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => sendMessage(userInput.value.trim(), e.target.result);
            reader.readAsDataURL(file);
        } else {
            alert(`抱歉，祐祐目前只能看懂圖片檔案喔！`);
        }
        event.target.value = '';
    };
    fileInput.addEventListener('change', handleFileSelection);
    cameraInput.addEventListener('change', handleFileSelection);

    // 4. 重寫音訊播放邏輯
    const playAudio = (base64Audio) => {
        // 播放前的第一道關卡：檢查聲音開關是否開啟
        if (!isSpeechEnabled) {
            console.log("語音已禁用，跳過播放。");
            return;
        }

        // 如果沒有音訊資料，直接結束即可，不用隱藏按鈕
        if (!base64Audio) {
            return;
        }

        if (currentAudio) currentAudio.pause();
        const audioSource = `data:audio/mpeg;base64,${base64Audio}`;
        currentAudio = new Audio(audioSource);

        currentAudio.onplaying = () => {
            toggleSpeechBtn.classList.add('speaking');
        };
        currentAudio.onpause = () => {
             toggleSpeechBtn.classList.remove('speaking');
        };
        currentAudio.onended = () => {
            toggleSpeechBtn.classList.remove('speaking'); // 播放結束後，只需移除 'speaking' 狀態
            currentAudio = null;
        };
        
        currentAudio.play();
    };

    // 5. 重寫聲音按鈕的點擊事件
    toggleSpeechBtn.addEventListener('click', () => {
        // 切換聲音開關的狀態
        isSpeechEnabled = !isSpeechEnabled;
        // 將新的設定存入 localStorage
        localStorage.setItem('yoyo_speech_enabled', isSpeechEnabled);
        // 更新按鈕的 UI
        updateSpeechButtonUI();

        // 如果在播放時點擊靜音，則立即停止當前的音訊
        if (!isSpeechEnabled && currentAudio) {
            currentAudio.pause();
        }
    });

    // --- 打字機效果函式 ---
    function typewriter(element, text, speed = 30, callback) {
        let i = 0;
        element.textContent = ""; // 先清空內容
        element.classList.remove('typing-cursor'); // 開始打字前，先移除閃爍的游標

        const interval = setInterval(() => {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                chatBox.scrollTop = chatBox.scrollHeight; // 隨時滾動到底部
            } else {
                clearInterval(interval); // 文字顯示完畢，清除計時器
                if (callback) {
                    callback(); // 呼叫回呼函式 (例如：播放音訊)
                }
            }
        }, speed);
    }

    // --- 訊息發送與串流處理核心函式 ---
    const sendMessage = async (message, imageBase64 = null) => {
        if (!message && !imageBase64) return;
        
        userInput.value = "";
        userInput.disabled = true;
        addMessageToChatBox(message, "user", imageBase64);

        const messageParts = [];
        if (message) messageParts.push(message);
        if (imageBase64) {
            const match = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/);
            if(match) messageParts.push({ inline_data: { mime_type: match[1], data: match[2] } });
        }
        conversationHistory.push({ role: 'user', parts: messageParts });
        
        if(currentAudio) currentAudio.pause();

        const aiMessageElement = createMessageElement("ai");
        const p = aiMessageElement.querySelector('p');
        chatBox.appendChild(aiMessageElement);
        p.classList.add('typing-cursor');

        try {
            const response = await fetch(CHAT_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    history: conversationHistory,
                    userId: userId 
                }),
            });

            if (!response.ok) {
                throw new Error(`伺服器回應錯誤 ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const SEPARATOR = "---YOYO_AUDIO_SEPARATOR---";
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
            }

            const separatorIndex = buffer.indexOf(SEPARATOR);
            const textPart = (separatorIndex !== -1) ? buffer.substring(0, separatorIndex) : buffer;
            const audioPart = (separatorIndex !== -1) ? buffer.substring(separatorIndex + SEPARATOR.length) : null;
            
            typewriter(p, textPart, 30, () => {
                conversationHistory.push({ role: 'model', parts: [textPart] });
                if (audioPart) {
                    playAudio(audioPart);
                }
                userInput.disabled = false;
                userInput.focus();
            });
            
        } catch (error) {
            p.classList.remove('typing-cursor');
            p.textContent = `糟糕，祐祐好像斷線了 (${error.message})`;
            console.error("捕獲到一個錯誤:", error);
            if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                 conversationHistory.pop();
            }
            userInput.disabled = false;
            userInput.focus();
        } 
    };

    // --- 提交表單邏輯 ---
    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        sendMessage(userInput.value.trim());
    });

    // --- UI 輔助函式 ---
    function createMessageElement(sender, messageText = "", imageBase64 = null) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", `${sender}-message`);
        if (sender === 'ai') {
            const avatar = document.createElement("img");
            avatar.src = "/yoyo-avatar.png"; 
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

    function addMessageToChatBox(message, sender, imageBase64 = null) {
        const messageElement = createMessageElement(sender, message, imageBase64);
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    
    // --- 麥克風邏輯 ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-TW';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onstart = () => micBtn.classList.add("recording");
        recognition.onresult = (event) => sendMessage(event.results[0][0].transcript);
        recognition.onerror = (event) => console.error("語音辨識錯誤:", event.error);
        recognition.onend = () => micBtn.classList.remove("recording");
        micBtn.addEventListener("click", () => recognition.start());
    } else {
        micBtn.style.display = "none";
    }
});