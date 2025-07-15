document.addEventListener("DOMContentLoaded", () => {
    // --- 變數定義 (不變) ---
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

    // --- 使用者ID管理 (不變) ---
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
    getOrSetUserId();

    // --- 檔案/相機上傳 (不變) ---
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

    // --- 音訊播放邏輯 (不變) ---
    const playAudio = (base64Audio) => {
        if (!base64Audio) {
            toggleSpeechBtn.style.display = 'none';
            return;
        }
        if (currentAudio) currentAudio.pause();
        const audioSource = `data:audio/mpeg;base64,${base64Audio}`;
        currentAudio = new Audio(audioSource);
        currentAudio.onplaying = () => {
            toggleSpeechBtn.classList.add('speaking');
            toggleSpeechBtn.textContent = '🔊';
        };
        currentAudio.onpause = () => {
             toggleSpeechBtn.classList.remove('speaking');
             toggleSpeechBtn.textContent = '🔇';
        };
        currentAudio.onended = () => {
            toggleSpeechBtn.style.display = 'none';
            currentAudio = null;
        };
        toggleSpeechBtn.style.display = 'flex';
        currentAudio.play();
    };

    toggleSpeechBtn.addEventListener('click', () => {
        if (!currentAudio) return;
        if (!currentAudio.paused) currentAudio.pause();
        else currentAudio.play();
    });

    // --- ✨ 新增：打字機效果函式 ✨ ---
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

    // --- ✨ 核心修改：訊息發送函式 ✨ ---
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
        p.classList.add('typing-cursor'); // 先顯示閃爍的游標，表示正在思考

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

            // 步驟 1: 持續讀取，直到串流結束，只收集資料不渲染
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
            }

            // 步驟 2: 迴圈結束後，我們保證 buffer 中有完整的資料，此時才進行分割
            const separatorIndex = buffer.indexOf(SEPARATOR);
            const textPart = (separatorIndex !== -1) ? buffer.substring(0, separatorIndex) : buffer;
            const audioPart = (separatorIndex !== -1) ? buffer.substring(separatorIndex + SEPARATOR.length) : null;
            
            // 步驟 3: 呼叫打字機函式來顯示文字
            // 當打字結束後，回呼函式會被觸發
            typewriter(p, textPart, 30, () => {
                // 將最終的回應加入歷史紀錄
                conversationHistory.push({ role: 'model', parts: [textPart] });
                // 在文字顯示完畢後，才播放音訊
                if (audioPart) {
                    playAudio(audioPart);
                }
                // 恢復輸入框
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
            // 發生錯誤時也要恢復輸入框
            userInput.disabled = false;
            userInput.focus();
        } 
        // 注意：`finally` 區塊被移除了，因為恢復輸入框的邏輯被整合到 typewriter 的回呼函式中
    };

    // --- 提交表單邏輯 (不變) ---
    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        sendMessage(userInput.value.trim());
    });

    // --- UI 輔助函式 (不變) ---
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
    
    // --- 麥克風邏輯 (不變) ---
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