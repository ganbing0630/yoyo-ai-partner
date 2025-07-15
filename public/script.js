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

    // 後端 API 端點
    const CHAT_API_URL = "/api/chat";
    const TTS_API_URL = "/api/tts";

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

    // --- NEW: 新增的獨立語音合成函式 ---
    async function fetchAndPlayAudio(text) {
        if (!text) return;
    
        try {
            const response = await fetch(TTS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
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


    // --- MODIFIED: 完全重寫的 sendMessage 函式，以支援文字串流 ---
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

        // 1. 立即建立 AI 的訊息框，準備接收串流內容
        const aiMessageElement = createMessageElement("ai");
        const p = aiMessageElement.querySelector('p');
        chatBox.appendChild(aiMessageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
        p.classList.add('typing-cursor'); // 立即顯示打字游標

        try {
            const response = await fetch(CHAT_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ history: conversationHistory }),
            });

            if (!response.ok) {
                throw new Error(`伺服器回應錯誤 ${response.status}`);
            }

            // 2. 準備讀取和解碼串流
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullReply = "";

            // 3. 使用 while 迴圈持續讀取和顯示文字
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break; // 串流結束
                }
                const chunk = decoder.decode(value, { stream: true });
                fullReply += chunk;
                p.textContent = fullReply; // 即時更新文字內容
                chatBox.scrollTop = chatBox.scrollHeight; // 保持滾動到底部
            }
            
            p.classList.remove('typing-cursor'); // 所有文字顯示完畢，移除游標

            // 將完整的 AI 回應加入歷史紀錄
            conversationHistory.push({ role: 'model', parts: [fullReply] });

            // 4. 當文字串流完全結束後，用收集到的完整文字去請求語音
            if (fullReply) {
                await fetchAndPlayAudio(fullReply);
            }

        } catch (error) {
            p.classList.remove('typing-cursor');
            p.textContent = `糟糕，祐祐好像斷線了 (${error.message})`;
            console.error("捕獲到一個錯誤:", error);
            conversationHistory.pop(); // 移除失敗的使用者輸入
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
        // AI訊息即使為空也要創建p標籤，以便之後填入串流內容
        if (messageText || sender === 'ai') { 
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