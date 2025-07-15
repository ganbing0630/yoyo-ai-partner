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
    const TTS_API_URL = "/api/tts";

    let conversationHistory = [];
    let currentAudio = null;

    // --- 檔案/相機上傳 ---
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

    // --- 音訊播放邏輯 ---
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

    // --- 獨立語音合成函式 ---
    async function fetchAndPlayAudio(segments) {
        if (!segments || segments.length === 0) return;
        try {
            const response = await fetch(TTS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ segments: segments })
            });
            if (!response.ok) {
                console.error(`語音合成 API 錯誤: ${response.status}`);
                return;
            }
            const data = await response.json();
            if (data.audio_content) {
                playAudio(data.audio_content);
            }
        } catch (error) {
            console.error("呼叫語音合成 API 時失敗:", error);
        }
    }

    // --- 主要訊息發送函式 (支援混合串流) ---
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
            const SEPARATOR = "---YOYO_SSML_SEPARATOR---";
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });

                if (buffer.includes(SEPARATOR)) {
                    const parts = buffer.split(SEPARATOR);
                    p.textContent += parts[0]; // 顯示分隔符前的最後文字
                    
                    const jsonPart = parts[1];
                    if (jsonPart) {
                        const segments = JSON.parse(jsonPart);
                        conversationHistory.push({ role: 'model', parts: [p.textContent] });
                        await fetchAndPlayAudio(segments);
                    }
                    break; // 處理完畢，跳出迴圈
                }
                
                // 持續更新文字，但不處理分隔符
                p.textContent = buffer;
                chatBox.scrollTop = chatBox.scrollHeight;
            }
            
            p.classList.remove('typing-cursor');

        } catch (error) {
            p.classList.remove('typing-cursor');
            p.textContent = `糟糕，祐祐好像斷線了 (${error.message})`;
            console.error("捕獲到一個錯誤:", error);
            if (conversationHistory[conversationHistory.length - 1].role === 'user') {
                 conversationHistory.pop();
            }
        } finally {
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