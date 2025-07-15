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

    // --- 檔案/相機上傳 (不變) ---
    cameraBtn.addEventListener('click', () => cameraInput.click());
    uploadBtn.addEventListener('click', () => fileInput.click());
    
    const handleFileSelection = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                sendMessage(userInput.value.trim(), e.target.result);
            };
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

    // --- 修正後的訊息發送函式 ---
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
                body: JSON.stringify({ history: conversationHistory }),
            });

            if (!response.ok) {
                throw new Error(`伺服器回應錯誤 ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const SEPARATOR = "---YOYO_AUDIO_SEPARATOR---";
            let buffer = "";

            // --- 核心修正：重寫串流處理迴圈 ---
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    // 如果串流意外結束，但緩衝區仍有內容，則將其顯示
                    p.textContent = buffer;
                    break;
                }
                
                buffer += decoder.decode(value, { stream: true });
                const separatorIndex = buffer.indexOf(SEPARATOR);

                if (separatorIndex !== -1) {
                    // 找到了分隔符！代表文字串流結束了。
                    const textPart = buffer.substring(0, separatorIndex);
                    const audioPart = buffer.substring(separatorIndex + SEPARATOR.length);
                    
                    // 1. 顯示最終的、完整的文字
                    p.textContent = textPart;
                    
                    // 2. 將完整的文字回應加入歷史紀錄
                    conversationHistory.push({ role: 'model', parts: [p.textContent] });

                    // 3. 播放音訊
                    playAudio(audioPart); 
                    
                    // 4. 任務完成，跳出迴圈
                    break; 
                } else {
                    // 如果還沒找到分隔符，代表所有內容都是文字
                    // 持續更新畫面，這會產生流式輸出的效果
                    p.textContent = buffer;
                    chatBox.scrollTop = chatBox.scrollHeight;
                }
            }
            
            p.classList.remove('typing-cursor');

        } catch (error) {
            p.classList.remove('typing-cursor');
            p.textContent = `糟糕，祐祐好像斷線了 (${error.message})`;
            console.error("捕獲到一個錯誤:", error);
            // 如果請求失敗，從歷史紀錄中移除剛才送出的那句話
            if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                 conversationHistory.pop();
            }
        } finally {
            userInput.disabled = false;
            userInput.focus();
        }
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