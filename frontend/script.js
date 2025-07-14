// script.js (Vercel 適配 + 模擬串流動畫版)

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

    const API_URL = "/api/chat"; 

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
                const imageBase64 = e.target.result;
                const messageText = userInput.value.trim();
                sendMessage(messageText, imageBase64);
            };
            reader.readAsDataURL(file);
        } else {
            alert(`抱歉，祐祐目前只能看懂圖片檔案喔！`);
        }
        event.target.value = '';
    };

    fileInput.addEventListener('change', handleFileSelection);
    cameraInput.addEventListener('change', handleFileSelection);

    // --- MODIFIED: 修改 typeWriter 以接受 callback ---
    function typeWriter(element, text, callback) {
        let i = 0;
        const speed = 50; // 打字速度 (ms)
        
        function type() {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                chatBox.scrollTop = chatBox.scrollHeight;
                setTimeout(type, speed);
            } else {
                if (callback) callback(); // 完成後調用回呼函式
            }
        }
        type();
    }

    // --- NEW: 新增回應動畫的總指揮函式 ---
    async function animateResponse(segments, audioContent) {
        // 1. 創建一個空的 AI 訊息框
        const aiMessageElement = createMessageElement("ai");
        const p = aiMessageElement.querySelector('p');
        chatBox.appendChild(aiMessageElement);
        p.classList.add('typing-cursor'); // 立即顯示游標

        // 2. 開始播放完整的音訊
        playAudio(audioContent);

        // 3. 使用 async/await 依序為每個片段播放打字動畫
        for (const segment of segments) {
            // 等待當前片段的打字機效果完成
            await new Promise(resolve => {
                typeWriter(p, segment.text + " ", resolve);
            });
            // 可以在片段之間加入一個微小的固定延遲，讓節奏更自然
            // await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        p.classList.remove('typing-cursor'); // 所有動畫完成後，移除游標

        // 4. 動畫全部完成後，才將完整的回應加入歷史紀錄
        const fullReply = p.textContent.trim();
        conversationHistory.push({ role: 'model', parts: [fullReply] });
    }

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

    // --- MODIFIED: 修改 sendMessage 以調用動畫函式 ---
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

        showTypingIndicator();
        if(currentAudio) currentAudio.pause();

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ history: conversationHistory }),
            });

            removeTypingIndicator();
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `伺服器錯誤: ${response.status}`);
            }
            
            const data = await response.json();
            
            // 調用新的動畫函式，而不是直接 addMessageToChatBox 和 playAudio
            await animateResponse(data.segments, data.audio_content);

            // 注意：conversationHistory 的 model 部分已經在 animateResponse 中處理

        } catch (error) {
            console.error("錯誤:", error);
            removeTypingIndicator();
            addMessageToChatBox(`糟糕，祐祐好像斷線了 (${error.message})`, "ai");
            conversationHistory.pop();
        } finally {
            userInput.disabled = false;
            userInput.focus();
        }
    };

    // --- 提交表單邏輯 (不變) ---
    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const userMessage = userInput.value.trim();
        if (userMessage) sendMessage(userMessage);
    });

    // --- UI 輔助函式 (不變) ---
    function createMessageElement(sender, messageText = "", imageBase64 = null) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", `${sender}-message`);
        if (sender === 'ai') {
            const avatar = document.createElement("img");
            avatar.src = "yoyo-avatar.png"; avatar.alt = "ai-avatar"; avatar.className = "avatar";
            messageElement.appendChild(avatar);
        }
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        if (messageText || sender === 'ai') { // AI訊息即使為空也要創建p標籤
            const p = document.createElement("p");
            p.textContent = messageText;
            contentDiv.appendChild(p);
        }
        if (imageBase64 && sender === 'user') {
            const img = document.createElement('img');
            img.src = imageBase64; img.alt = "uploaded-image";
            img.onclick = () => window.open(imageBase64);
            contentDiv.appendChild(img);
        }
        messageElement.appendChild(contentDiv);
        return messageElement;
    }

    function addMessageToChatBox(message, sender, imageBase64 = null) {
        const messageElement = createMessage_element(sender, message, imageBase64);
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