# 知識庫運維指南 (KB Operations)

## 架構說明
本項目採用 **Vercel Blob** 作為知識庫存儲後端，實現「文件即知識」的動態更新。

- **存儲位置**：Vercel Blob Storage
- **文件目錄**：由環境變量 `KB_BLOB_PREFIX` 決定（預設：`ningle-temp-images/app知识库/`）
- **支持格式**：`.docx` (Word 文檔)
- **讀取邏輯**：
  1. API 收到請求，提取當前輪次用戶問題（最後一條 user message）。
  2. 若命中 `services/kbFromBlob.js` 中定義的「業務關鍵詞」，後端 (`api/chat.js`) 會嘗試調用 `services/kbFromBlob.js` 檢索知識庫。
  3. 系統自動列出 `KB_BLOB_PREFIX` 下的所有 `.docx/.doc` 文件。
  4. 下載並解析為純文本（使用 `mammoth`）。
  5. 緩存於 Serverless Function 內存中（Warm Start 時複用）。
  6. 根據用戶問題進行關鍵詞匹配，截取最相關段落注入 LLM Context。
  7. **性能保護**：KB 查詢帶超時（約 1–2 秒），超時/失敗會靜默跳過，不影響正常聊天。

## 如何更新知識庫
**無需修改任何代碼！**

1. 準備好新的知識文檔（`.docx` 格式）。
   - 建議文件名清晰，例如：`板材與五金百科.docx`。
   - 內容結構建議使用標題（Heading 1, Heading 2）和列點，便於解析。
2. 登錄 Vercel Dashboard -> Storage -> Blob。
3. 進入/創建文件夾（對應 `KB_BLOB_PREFIX`，預設為 `ningle-temp-images/app知识库/`）。
4. 上傳新的 `.docx` 文件，或刪除舊文件。
5. **生效時間**：
   - 由於 Serverless 緩存機制，更新可能會有幾分鐘延遲（取決於實例存活時間）。
   - 若要強制刷新，可以重新部署項目 (Redeploy)，或者等待舊實例自動銷毀。

## 故障排查
若發現機器人無法回答知識庫內容：

1. **檢查狀態**：
   - 訪問線上 API：`GET /api/kbStatus`
   - 正常回傳：`{ "ok": true, "files": 5, "loaded": true }`
   - 若 `files` 為 0，檢查 Blob 是否上傳正確目錄。
   - 若 `ok` 為 false，檢查環境變量 `BLOB_READ_WRITE_TOKEN`。

2. **檢查環境變量**：
   - 確保 Vercel Project Settings 中已關聯 Blob Store，並且 `BLOB_READ_WRITE_TOKEN` 存在。

3. **關鍵詞未命中**：
   - 機器人只在命中 `services/kbFromBlob.js` 定義的 `BUSINESS_KEYWORDS` 時才會查詢 Blob（不再是“永遠查詢”）。
   - 嘗試輸入包含「價錢」、「板材」、「工廠」等明確字眼的句子測試。
