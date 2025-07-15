// script.js (已修正靜音後無法再次播放的 Bug)
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

    const CHAT_API_URL = "https://yoyo-ai-partner-backend.onrender.com/api/chat"; // 請確保這是你後端的正確網址

    let conversationHistory = [];
    let currentAudio = null;
    let userId = null;
    let isSpeechEnabled = true;

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
    
    getOrSetUserId();
    initializeSpeechSetting();

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

    const playAudio = (base64Audio) => {
        if (!isSpeechEnabled) {
            console.log("語音已禁用，跳過播放。");
            return;
        }
        if (!base64Audio) {
            return;
        }
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

    // --- 核心修正點 ---
    toggleSpeechBtn.addEventListener('click', () => {
        isSpeechEnabled = !isSpeechEnabled;
        localStorage.setItem('yoyo_speech_enabled', isSpeechEnabled);
        updateSpeechButtonUI();

        // 如果在播放時點擊靜音，則立即停止當前的音訊
        if (!isSpeechEnabled && currentAudio) {
            currentAudio.pause();
            // 加上這一行，來徹底清除被暫停的「幽靈音訊」
            currentAudio = null; 
        }
    });

    function typewriter(element, text, speed = 30, callback) {
        let i = 0;
        element.textContent = "";
        element.classList.remove('typing-cursor');

        const interval = setInterval(() => {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                chatBox.scrollTop = chatBox.scrollHeight;
            } else {
                clearInterval(interval);
                if (callback) {
                    callback();
                }
            }
        }, speed);
    }

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

    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        sendMessage(userInput.value.trim());
    });

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