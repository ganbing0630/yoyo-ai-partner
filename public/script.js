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

    // --- 檔案/相機上傳 ---
    cameraBtn.addEventListener('click', () => cameraInput.click());
    uploadBtn.addEventListener('click', () => fileInput.click());
    
    const handleFileSelection = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                // 將圖片與當前輸入框的文字一起發送
                sendMessage(userInput.value.trim(), e.target.result);
            };
            reader.readAsDataURL(file);
        } else {
            alert(`抱歉，祐祐目前只能看懂圖片檔案喔！`);
        }
        event.target.value = ''; // 清空選擇，以便下次能選擇同一個檔案
    };
    fileInput.addEventListener('change', handleFileSelection);
    cameraInput.addEventListener('change', handleFileSelection);

    // --- 音訊播放邏輯 ---
    const playAudio = (base64Audio) => {
        if (!base64Audio) {
            toggleSpeechBtn.style.display = 'none';
            return;
        }
        if (currentAudio) {
            currentAudio.pause();
        }
        const audioSource = `data:audio/mpeg;base64,${base64Audio}`;
        currentAudio = new Audio(audioSource);
        
        const onPlay = () => {
            toggleSpeechBtn.classList.add('speaking');
            toggleSpeechBtn.textContent = '🔊';
        };
        const onPause = () => {
             toggleSpeechBtn.classList.remove('speaking');
             toggleSpeechBtn.textContent = '🔇';
        };
        
        currentAudio.addEventListener('play', onPlay);
        currentAudio.addEventListener('playing', onPlay);
        currentAudio.addEventListener('pause', onPause);

        currentAudio.onended = () => {
            toggleSpeechBtn.style.display = 'none';
            currentAudio = null;
        };
        
        toggleSpeechBtn.style.display = 'flex';
        currentAudio.play().catch(error => console.error("音訊播放失敗:", error));
    };

    toggleSpeechBtn.addEventListener('click', () => {
        if (!currentAudio) return;
        if (currentAudio.paused) {
            currentAudio.play();
        } else {
            currentAudio.pause();
        }
    });

    // --- 訊息發送與串流處理核心函式 ---
    const sendMessage = async (message, imageBase64 = null) => {
        if (!message && !imageBase64) return;
        
        const userInputValue = message || "";
        userInput.value = ""; // 清空輸入框
        userInput.disabled = true;
        
        addMessageToChatBox(userInputValue, "user", imageBase64);

        // 建立要發送給後端的訊息結構
        const userMessageParts = [];
        if (message) {
            userMessageParts.push(message);
        }
        if (imageBase64) {
            userMessageParts.push({ inline_data: { mime_type: imageBase64.match(/^data:(image\/\w+);/)[1], data: imageBase64.split(',')[1] } });
        }
        conversationHistory.push({ role: 'user', parts: userMessageParts });
        
        if(currentAudio) currentAudio.pause();

        // 建立 AI 回應的 DOM 元素
        const aiMessageElement = createMessageElement("ai");
        const p = aiMessageElement.querySelector('p');
        chatBox.appendChild(aiMessageElement);
        p.classList.add('typing-cursor'); // 添加打字機游標效果

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

            // --- 核心邏輯：先完整接收串流，再處理 ---
            
            // 步驟 1: 持續讀取和即時渲染文字，直到串流結束
            while (true) {
                const { done, value } = await reader.read();
                if (done) break; // 當串流結束時，跳出迴圈
                
                buffer += decoder.decode(value, { stream: true });
                
                // 即時更新畫面上的文字，只顯示分隔符前的內容
                p.textContent = buffer.split(SEPARATOR)[0];
                chatBox.scrollTop = chatBox.scrollHeight;
            }

            // 步驟 2: 迴圈結束後，`buffer` 中已包含所有數據，此時才進行分割
            const separatorIndex = buffer.indexOf(SEPARATOR);
            let textPart;
            let audioPart = null;

            if (separatorIndex !== -1) {
                textPart = buffer.substring(0, separatorIndex);
                audioPart = buffer.substring(separatorIndex + SEPARATOR.length);
            } else {
                // 如果沒有找到分隔符，代表可能只有文字或發生錯誤
                textPart = buffer;
            }
            
            // 更新最終、正確的文字，並將其加入對話歷史
            p.textContent = textPart;
            conversationHistory.push({ role: 'model', parts: [textPart] });

            // 在所有文字都顯示完畢後，才播放音訊
            if(audioPart && audioPart.length > 10) { // 簡單檢查音訊字串是否有效
               playAudio(audioPart);
            }

        } catch (error) {
            p.textContent = `糟糕，祐祐好像斷線了 (${error.message})`;
            console.error("捕獲到一個錯誤:", error);
            // 如果最後一則訊息是使用者發送的，但 AI 回應失敗，則將其從歷史紀錄中移除，以便重試
            if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                 conversationHistory.pop();
            }
        } finally {
            // 無論成功或失敗，最後都恢復輸入框的狀態
            p.classList.remove('typing-cursor');
            userInput.disabled = false;
            userInput.focus();
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    };

    // --- 表單提交 ---
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
        
        // 使用者訊息中的圖片放在文字上方
        if (imageBase64 && sender === 'user') {
            const img = document.createElement('img');
            img.src = imageBase64;
            img.alt = "uploaded-image";
            img.style.marginBottom = messageText ? '8px' : '0'; // 如果有文字，則增加間距
            img.onclick = () => window.open(imageBase64);
            contentDiv.appendChild(img);
        }

        // 訊息文字
        if (messageText || sender === 'ai') { // AI 訊息即使為空也先建立 p 標籤
            const p = document.createElement("p");
            p.textContent = messageText;
            contentDiv.appendChild(p);
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
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            sendMessage(transcript);
        };
        
        recognition.onerror = (event) => console.error("語音辨識錯誤:", event.error);
        
        recognition.onend = () => micBtn.classList.remove("recording");
        
        micBtn.addEventListener("click", () => {
             try {
                recognition.start();
             } catch(e) {
                console.error("無法啟動語音辨識:", e);
             }
        });
    } else {
        micBtn.style.display = "none";
    }
});