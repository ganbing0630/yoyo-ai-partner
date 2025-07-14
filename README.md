# 祐祐 - AI 知識夥伴 🚀

![Yoyo AI Partner](./yoyo-avatar.png)

這是一個專為兒童設計的 AI 知識夥伴，名叫「祐祐」。它不僅能用充滿情感的聲音回答孩子們的各種問題，還能「看見」孩子們分享的圖片（例如他們的畫作），並給予溫暖的鼓勵和讚美。

## ✨ 主要功能

*   **情感語音合成**：祐祐的回答會被拆分成多個帶有不同情感（如開朗、安慰、興奮）的語音片段，並一次性合成為自然、有溫度的語音。
*   **多模態理解**：孩子可以拍照或上傳圖片，祐祐能夠理解圖片內容並作出相關的回應，特別適合讚美孩子的畫作。
*   **一次性完整回應**：應用採用 Serverless 架構，在接收到請求後，會完整生成文字與語音，並一次性回傳給使用者。
*   **兒童友善的互動**：經過特殊設計的系統提示 (System Prompt) 讓祐祐的回應總是充滿想像力、鼓勵性和正能量。
*   **語音輸入**：支援麥克風語音輸入，方便不擅長打字的孩子使用。

## 🛠️ 使用技術

*   **後端**:
    *   **框架**: Flask
    *   **語言模型**: Google Gemini 1.5 Flash (多模態 & JSON 輸出)
    *   **語音合成 (TTS)**: Azure Cognitive Services Speech
    *   **部署**: Vercel (Serverless Functions)
*   **前端**:
    *   HTML5 / CSS3 / JavaScript
    *   Web Speech API (語音辨識)
    *   Fetch API

## 🚀 如何在本地運行

1.  **複製專案**
    ```bash
    git clone https://github.com/ganbing0630/yoyo-ai-partner.git
    cd yoyo-ai-partner
    ```
2.  **建立虛擬環境並安裝依賴**
    ```bash
    python -m venv .venv
    source .venv/bin/activate  # On Windows, use `.venv\Scripts\activate`
    pip install -r requirements.txt
    ```
3.  **設定環境變數**
    *   建立一個 `.env` 檔案。
    *   填入必要的 API 金鑰：
        ```
        GEMINI_API_KEY="YOUR_GEMINI_KEY"
        SPEECH_KEY="YOUR_AZURE_SPEECH_KEY"
        SPEECH_REGION="YOUR_AZURE_SPEECH_REGION"
        ```
4.  **啟動本地開發伺服器**
    ```bash
    python app.py
    ```
5.  在檔案總管中，直接用滑鼠雙擊 `index.html` 檔案即可在瀏覽器中打開並開始互動。

## 部署

這個專案已配置好 (`vercel.json`)，可直接透過與 GitHub 倉庫連動的方式，無縫部署到 [Vercel](https://vercel.com/)。任何推送到 `main` 分支的提交都將自動觸發新的部署。

---
*這個專案是作為 AI 應用開發的範例而創建的。*