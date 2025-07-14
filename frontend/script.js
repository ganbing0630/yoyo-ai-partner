// script.js (完整版)

document.addEventListener("DOMContentLoaded", () => {
    // --- 變數定義 ---
    const chatForm = document.getElementById("chat-form");
    const userInput = document.getElementById("user-input");
    const chatBox = document.getElementById("chat-box");
    const micBtn = document.getElementById("mic-btn");
    const toggleSpeechBtn = document.getElementById("toggle-speech-btn");
    
    // 新增的按鈕和輸入框
    const cameraBtn = document.getElementById("camera-btn");
    const uploadBtn = document.getElementById("upload-btn");
    const fileInput = document.getElementById("file-input");
    const cameraInput = document.getElementById("camera-input");

    // --- Socket.IO 連線 ---
    const socket = io("http://127.0.0.1:5000");

    // --- 全域變數 ---
    let conversationHistory = [];
    let audioQueue = [];
    let isPlaying = false;
    let currentAiMessageElement = null;
    let currentAiParagraphElement = null;

    // --- 處理檔案/相機上傳 ---
    cameraBtn.addEventListener('click', () => {
        cameraInput.click();
    });

    uploadBtn.addEventListener('click', () => {
        fileInput.click();
    });

    // 兩個輸入框共用同一個處理函式
    const handleFileSelection = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // 我們只處理圖片檔案的預覽和發送
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const imageBase64 = e.target.result;
                const messageText = userInput.value.trim();
                sendMessage(messageText, imageBase64);
            };
            reader.readAsDataURL(file);
        } else {
            // 對於非圖片檔案，可以進行不同的處理
            // 目前，我們簡單地顯示檔名並提示無法預覽
            const messageText = userInput.value.trim() || `我上傳了一個檔案：${file.name}`;
            addMessageToChatBox(messageText, "user");
            alert(`抱歉，祐祐目前只能看懂圖片檔案喔！這個檔案 (${file.name}) 還沒辦法處理。`);
            // 如果未來後端支援其他檔案類型，可以在這裡擴充
        }

        // 清空 input 的值，以便下次能選擇同一個檔案
        event.target.value = '';
    };

    fileInput.addEventListener('change', handleFileSelection);
    cameraInput.addEventListener('change', handleFileSelection);


    // --- 打字機效果函式 (不變) ---
    function typeWriter(element, text, callback) {
        let i = 0;
        const speed = 50;
        element.classList.add('typing-cursor');

        function type() {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                chatBox.scrollTop = chatBox.scrollHeight;
                setTimeout(type, speed);
            } else {
                element.classList.remove('typing-cursor');
                if (callback) callback();
            }
        }
        type();
    }

    // --- Socket.IO 事件監聽 (不變) ---
    socket.on('connect', () => console.log('成功連接到伺服器！ Socket ID:', socket.id));
    socket.on('disconnect', () => console.log('與伺服器斷開連接'));
    socket.on('ai_chunk', (data) => {
        removeTypingIndicator();
        if (!currentAiMessageElement) {
            currentAiMessageElement = createMessageElement("ai");
            currentAiParagraphElement = currentAiMessageElement.querySelector('p');
            chatBox.appendChild(currentAiMessageElement);
        }
        const existingText = currentAiParagraphElement.textContent;
        currentAiParagraphElement.textContent = existingText;
        typeWriter(currentAiParagraphElement, data.text + " ", () => {});
        if (data.audio_content) {
            audioQueue.push(data.audio_content);
            if (!isPlaying) {
                playNextInQueue();
            }
        }
    });
    socket.on('stream_end', (data) => {
        console.log('串流結束:', data.message);
        if (currentAiParagraphElement) {
            currentAiParagraphElement.classList.remove('typing-cursor');
            const fullReply = currentAiParagraphElement.textContent.trim();
            conversationHistory.push({ role: 'model', parts: [fullReply] });
        }
        currentAiMessageElement = null;
        currentAiParagraphElement = null;
        userInput.disabled = false;
        userInput.focus();
    });
    socket.on('stream_error', (data) => {
        console.error('伺服器錯誤:', data.error);
        removeTypingIndicator();
        addMessageToChatBox("糟糕，祐祐好像斷線了，請稍後再試一次！", "ai");
        currentAiMessageElement = null;
        currentAiParagraphElement = null;
        userInput.disabled = false;
    });
    
    // --- 音訊播放邏輯 (不變) ---
    const playNextInQueue = () => {
        if (audioQueue.length === 0) {
            isPlaying = false;
            toggleSpeechBtn.style.display = 'none';
            toggleSpeechBtn.classList.remove('speaking');
            toggleSpeechBtn.textContent = '🔇';
            return;
        }
        isPlaying = true;
        toggleSpeechBtn.style.display = 'flex';
        toggleSpeechBtn.classList.add('speaking');
        toggleSpeechBtn.textContent = '🔊';
        const audioBase64 = audioQueue.shift();
        const audioSource = `data:audio/mpeg;base64,${audioBase64}`;
        const audio = new Audio(audioSource);
        audio.play();
        audio.onended = () => playNextInQueue();
        audio.onerror = () => {
            console.error("音訊播放錯誤");
            playNextInQueue();
        };
    };

    // --- 發送訊息邏輯 (不變) ---
    const sendMessage = (message, imageBase64 = null) => {
        if (!message && !imageBase64) return;
        
        userInput.value = "";
        userInput.disabled = true;
        addMessageToChatBox(message, "user", imageBase64);

        const messageParts = [];
        if (message) {
            messageParts.push(message);
        }
        if (imageBase64) {
            const match = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/);
            if(match) {
                messageParts.push({
                    inline_data: { mime_type: match[1], data: match[2] }
                });
            }
        }

        conversationHistory.push({ role: 'user', parts: messageParts });
        showTypingIndicator();
        socket.emit('chat_message', { history: conversationHistory });
    };

    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const userMessage = userInput.value.trim();
        if (userMessage) {
            sendMessage(userMessage);
        }
    });

    // --- UI 輔助函式 (不變) ---
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

        if (messageText) {
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

    function showTypingIndicator() {
        if (document.getElementById("typing-indicator")) return;
        const typingElement = createMessageElement("ai");
        typingElement.id = "typing-indicator";
        typingElement.classList.add('typing-indicator');
        const p = typingElement.querySelector('p');
        p.textContent = "祐祐思考中";
        chatBox.appendChild(typingElement);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function removeTypingIndicator() {
        const typingElement = document.getElementById("typing-indicator");
        if (typingElement) typingElement.remove();
    }
    
    // --- 麥克風和語音按鈕邏輯 (不變) ---
    toggleSpeechBtn.style.display = 'none';
    
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