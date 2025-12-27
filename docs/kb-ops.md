# 知识库运维指南（KB Operations）

## 架構說明
本项目采用 **Vercel Blob** 作为知识库存储后端，实现「文件即知识」的动态更新。

- **存储位置**：Vercel Blob Storage
- **文件目录**：由环境变量 `KB_BLOB_PREFIX` 决定（默认：`ningle-temp-images/app知识库/`）
- **支持格式**：`.docx` / `.doc`（Word 文档）
- **读取逻辑**：
  1. API 收到请求，提取当前轮次用户问题（最后一条 user message）。
  2. 若命中 `services/kbFromBlob.js` 中定义的「业务关键词」，后端（`api/chat.js`）会尝试调用 `services/kbFromBlob.js` 检索知识库。
  3. 系統自動列出 `KB_BLOB_PREFIX` 下的所有 `.docx/.doc` 文件。
  4. 下载并解析为纯文本（使用 `mammoth`）。
  5. 缓存于 Serverless Function 内存中（Warm Start 时复用）。
  6. 根据用户问题进行关键词匹配，截取最相关段落注入 LLM Context。
  7. **性能保护**：KB 查询带超时（约 1–2 秒），超时/失败会静默跳过，不影响正常聊天。

## 如何更新知识库
**无需修改任何代码！**

1. 准备好新的知识文档（`.docx` 格式）。
   - 建议文件名清晰，例如：`板材与五金百科.docx`。
   - 内容结构建议使用标题（Heading 1/2）和列表，便于解析。
2. 登录 Vercel Dashboard -> Storage -> Blob。
3. 进入/创建文件夹（对应 `KB_BLOB_PREFIX`，默认 `ningle-temp-images/app知识库/`）。
4. 上传新的 `.docx` 文件，或删除旧文件。
5. **生效时间**：
   - 由于 Serverless 缓存机制，更新可能会有几分钟延迟（取决于实例存活时间）。
   - 若要强制刷新，可以重新部署项目（Redeploy），或者等待旧实例自动销毁。

## 故障排查
若发现机器人无法回答知识库内容：

1. **检查状态**：
   - 访问线上 API：`GET /api/kbStatus`
   - 正常返回：`{ "ok": true, "files": 5, "loaded": true }`
   - 若 `files` 为 0，检查 Blob 是否上传到正确目录。
   - 若 `ok` 为 false，检查环境变量 `BLOB_READ_WRITE_TOKEN`。

2. **检查环境变量**：
   - 确保 Vercel Project Settings 中已关联 Blob Store，且 `BLOB_READ_WRITE_TOKEN` 存在。

3. **关键词未命中**：
   - 机器人只在命中 `services/kbFromBlob.js` 定义的 `BUSINESS_KEYWORDS` 时才会查询 Blob（不会每次都查）。
   - 尝试输入包含「价钱/报价/板材/工厂」等明确字眼的句子测试。
