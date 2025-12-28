# 全面检查报告（宁乐家居智能助手 V2）

> 目标：先“检查与定位”，不做大改动。本报告用于后续按问题逐步精准修正（香港户型纯文生图精度、分类稳定性、超时/并发等）。

## 1) 系统概览（技术栈 / 部署方式 / 结构）

### 1.1 技术栈
- **前端**：React 18 + TypeScript + Vite 5 + TailwindCSS  
  - 入口：`/workspace/index.tsx`、`/workspace/App.tsx`
- **后端**：Vercel Serverless Functions（Node runtime，路径 `/api/*`）
  - 函数超时配置：`/workspace/vercel.json`
- **依赖服务**
  - StepFun：
    - 视觉（VLM）：`step-1v-8k`
    - 文本（LLM）：`step-1-8k`
    - 生图（t2i / i2i）：`step-1x-medium`
  - Vercel Blob：图片上传、知识库 docx（可选）

### 1.2 Node / 构建
- **本地运行环境（本次检查机）**：Node `v22.21.1`，npm `10.9.4`
- **构建命令**：`npm run build`（`tsc && vite build`）✅（在安装依赖后可成功构建）

### 1.3 部署方式（Vercel）
- **路由形态**：不是 Next.js（无 App Router/Pages Router），而是 **静态站点 + `/api/*` Serverless Functions**。
- **超时（maxDuration）**（见 `vercel.json`）：
  - `api/design/generate.js`: 300s
  - `api/design/qa.js`: 120s
  - 其余 `api/**/*`: 60s（含 `/api/vision`、`/api/space`、`/api/chat`、`/api/upload`、`/api/design/inspire`、`/api/generate` 等）

---

## 2) 路由/端点清单（重点 API）

### 2.1 前端路由
- **SPA 单页应用**：只有 `/`（Vite 构建产物 `dist/index.html`），前端未使用 React Router。

### 2.2 后端 API routes（Vercel Functions）
目录：`/workspace/api/`

- **健康检查**
  - `GET /api/health` → `api/health.js`
  - `GET /api/env-check` → `api/env-check.js`（只返回布尔值，不泄露密钥）
  - `GET /api/vision-health` → `api/vision-health.js`（对 StepFun VLM 做 1x1 图片探活）
- **图片 / 视觉**
  - `POST /api/upload` → `api/upload.js`（上传到 Vercel Blob，返回 public URL）
  - `POST /api/space` → `api/space.js`（空间分类：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他）
  - `POST /api/vision` → `api/vision.js`（结构/约束/完成度 + 2 个布局建议 A/B + summary）
- **聊天**
  - `POST /api/chat` → `api/chat.js`（SSE 流式输出）
- **生图（legacy/兼容）**
  - `POST /api/generate` → `api/generate.js`（纯文生图，返回 base64 data-url；使用 `STEPFUN_IMAGE_API_KEY`）
- **生图（当前主流程）**
  - `POST /api/design/inspire` → `api/design/inspire.js`（文生图：基于“用户选择 + 结构锁定”拼 prompt，返回 url/data-url）
  - `POST /api/design/generate` → `api/design/generate.js`（图生图：以“当前效果图”做参考，做精修；可带 QA/自动二次 refine）
  - `POST /api/design/qa` → `api/design/qa.js`（对最终图做 QA + 生成中文设计说明）
- **知识库（可选）**
  - `GET /api/kbStatus` → `api/kbStatus.js`（Blob 列 docx 作为 KB 状态）
  - 注意：本地 dev 的 mock 路由里写的是 `GET /api/kb-status`（见 `vite.config.ts`），与线上 `GET /api/kbStatus` **不一致**（详见问题列表）。

---

## 3) 生成流程数据流（上传→分析→分类→选项→生成→返回→再生成/精修）

### 3.1 关键对象（前端状态）
`App.tsx` 中每次上传对应一个 `uploadId`，会记录：
- `dataUrl`（base64）
- `imageUrl`（若成功上传 Blob，则为 public URL，优先用于后续调用）
- `spaceType`、`visionSummary`、`visionExtraction`
- `layoutOptions`、`layoutRecommended`、`fixedConstraints`
- `render`（用户选择：风格/色系/布局/尺寸/强度等）
- `generatedImageUrl`（最后一次生成结果）

### 3.2 端到端主链路（按实际代码）
下面是“正常一次生成”的数据流（从 `App.tsx` 追踪到 services 与 `/api`）：

1) **上传图片**
   - 前端：`handleUpload(file)` → `compressImage(file, 1024, 0.75)`（`services/utils.ts`）
   - 立即在 UI 展示用户图片（chat bubble）
   - 并发尝试上传 Blob（不阻塞 UI）
     - `services/generateClient.ts::uploadImage` → `POST /api/upload`
     - 成功后回填 `uploads[uploadId].imageUrl = <public blob url>`

2) **空间分类（自动）**
   - 触发：上传后自动调用
   - `services/spaceClient.ts::classifySpace` → `POST /api/space`
   - payload（优先 URL、否则 dataUrl）：
     - `{ clientId, imageUrl }` 或 `{ clientId, imageDataUrl }`
   - 响应：`{ ok, primary, candidates[], reason }`
   - 前端弹出空间类型按钮（最多 8 个），用户点击确认

3) **视觉分析（结构/完成度/约束/布局建议）**
   - `runAnalysisForUpload(uploadId, spaceTypeText)`
   - `services/visionClient.ts::analyzeImage` → `POST /api/vision`
   - payload（优先 URL、否则 dataUrl）：
     - `{ mode: "consultant", clientId, spaceType, imageUrl? , imageDataUrl? }`
   - 响应（关键字段）：
     - `vision_summary`：4 行结构化 summary（结构/光线/完成度/约束）
     - `extraction`：包含门窗/梁柱/完成度/约束 + `layout_options`（服务端会标准化为 2 个选项）
   - 前端显示按钮：`生成智能效果图`

4) **用户选项（布局→尺寸→风格色调→快速确认）**
   - 点击 `生成智能效果图` 后进入“可点选的 intake flow”
   - 关键选择写入：`uploads[uploadId].render.*` 与 `lastRenderIntakeRef`
   - 最终会构造 `renderIntake`（包含 space/style/color/focus/尺寸/强度/visionSummary/visionExtraction 等）

5) **生成（主流程：文生图 /api/design/inspire）**
   - `triggerGeneration(intake)` → `services/generateClient.ts::generateInspireImage`
   - `POST /api/design/inspire`（文生图）
   - 响应（关键字段）：
     - `{ ok, resultUrl, debug? }`
   - 前端把图片结果加入消息流，并发调用 QA：
     - `POST /api/design/qa`（解释说明，供用户阅读）

6) **再生成/精修（主流程：图生图 /api/design/generate）**
   - 用户点击“再精修：xxx”
   - 优先使用“当前效果图”做参考图：`triggerEnhanceFromCurrent(baseImageUrl, tweak)`
   - `services/generateClient.ts::generateDesignImage` → `POST /api/design/generate`
   - 响应（关键字段）：
     - `{ ok, resultBlobUrl, designExplanation?, debug?, errorCode? }`
   - 若返回 `RATE_LIMITED` / `TIMEOUT`，前端有明确提示（`App.tsx` 对精修路径做了分支处理）

### 3.3 简图（数据流）

```
用户上传(file)
  -> compress -> dataUrl
  -> (并发) /api/upload -> imageUrl(Blob public)
  -> /api/space -> primary/candidates -> 用户确认spaceType
  -> /api/vision -> vision_summary + extraction(layout_options/constraints/finish)
  -> 用户选项(renderIntake: layout/dims/style...)
  -> /api/design/inspire (t2i) -> resultUrl
  -> /api/design/qa -> 设计说明
  -> 再精修: /api/design/generate (i2i) -> resultBlobUrl
```

---

## 4) API schema 摘要（输入/输出字段）

> 说明：以下为“代码层面”的 schema 摘要（用于后续对齐前端 payload 与后端期望）。不包含任何密钥值。

### 4.1 `POST /api/upload`
- **请求**：二进制 body（图片 Blob/File）  
  headers：`x-vercel-filename`、`x-client-id?`、`x-upload-id?`
- **响应**：Vercel Blob `put()` 的返回（至少含 `url`）
- **失败点**：缺 `BLOB_READ_WRITE_TOKEN` 直接 500

### 4.2 `POST /api/space`
- **请求**：`{ clientId?, imageUrl? | imageDataUrl? }`
- **响应**：`{ ok, primary, candidates:[{space,confidence}], reason }`
- **说明**：会把 URL 拉取转 base64 再发 StepFun VLM；并强制把输出映射到固定枚举

### 4.3 `POST /api/vision`
- **请求**：`{ spaceType?, imageUrl? | imageDataUrl?, mode?, clientId? }`
- **响应**：
  - `ok: true`
  - `vision_summary: string`（4 行，含“完成度：毛坯/半装/已装”）
  - `extraction: { space_type, doors_windows, columns, beams_ceiling, finish_level, fixed_constraints, layout_options(服务端标准化), recommended_index }`
- **说明**：如果用户传了 `spaceType`，服务端会强制锁定 `space_type` 并 **固定输出 2 个标准布局选项**

### 4.4 `POST /api/design/inspire`（主流程 t2i）
- **请求**：
  - `{ renderIntake, size?, response_format?, steps?, cfg_scale?, seed? }`
  - `renderIntake` 关键字段（前端会带）：
    - `space`、`targetUse?`（space=其他时很关键）
    - `style`、`color`
    - `focus`（用户选的“布局/动线”文本，作为 hard constraint）
    - `roomWidthChi`、`roomHeightChi`
    - `storage`、`decor`、`vibe`、`intensity`、`hallType?`
    - `visionSummary`、`visionExtraction`、`fixedConstraints`、`layoutRecommended`
- **响应**：`{ ok, resultUrl, debug? }`

### 4.5 `POST /api/design/generate`（精修 i2i）
- **请求**：
  - `{ baseImageBlobUrl, renderIntake?, size?, source_weight?, steps?, cfg_scale?, seed?, response_format?, fast_refine? }`
- **响应**：
  - `ok: true`
  - `resultBlobUrl`（可能是临时 url 或 data-url）
  - `designExplanation?`（可能来自图像 QA）
  - `debug`（含 `qa_pass`、`qa_skipped`、`ms_spent` 等）
  - 失败时：`{ ok:false, errorCode:'RATE_LIMITED'|'TIMEOUT'|... }`

### 4.6 `POST /api/design/qa`
- **请求**：`{ imageUrl, renderIntake? }`
- **响应**：`{ ok, qa?, designExplanation? }`

### 4.7 `POST /api/chat`
- **请求**：`{ messages:[{role,content}], visionSummary? }`
- **响应**：SSE 文本流（`text/event-stream`）

### 4.8 `POST /api/generate`（legacy）
- **请求**：`{ prompt, size? }`
- **响应**：`{ ok, b64_json: "data:image/png;base64,...", debug? }`
- **关键点**：使用的是 `STEPFUN_IMAGE_API_KEY`（与主流程统一 key 不同）

---

## 5) 文生图 prompt 生成位置与现况（定位：文件/函数/模板）

### 5.1 最终送去“纯文生图（t2i）”的 prompt 在哪里生成？
- **文件**：`/workspace/api/design/inspire.js`
- **关键逻辑**：
  - 读取 `renderIntake`
  - 生成 `structureCues`（把 `/api/vision` 的 `visionSummary/visionExtraction` 转成“结构锁定”英文硬约束）
  - 拼接 `roomTypeLock`（空间类型锁定；space=其他时用 `targetUse` 强行锁）
  - 拼接 `layoutLine`（用户选的布局文案作为 hard constraint）
  - 拼接 `mustHave / avoidBySpace / 通用负向约束`
  - 最终 `prompt` 限长到 **<= 1024 chars**（StepFun t2i 限制）

### 5.2 当前 prompt 是否具备你要求的几类“锁定层”？
- **结构锁定层（香港尺度/镜头/禁止夸张透视等）**：**已有部分**  
  - `structureCues` 内有：窗/梁/柱约束、房间几何、相机视角、禁止 fisheye、保持直线等
  - 但“香港尺度/禁止豪宅”等更强约束：目前主要靠 `mustHave` 与 `HK practicality` 文案，强度可进一步增强（后续按截图再细调）
- **spaceType 锁定**：**已有**  
  - `roomTypeLock` 明确要求 “MUST be xxx room type；Do NOT depict other room type”
  - space=其他时会用 `targetUse` 强锁（避免跑去日式茶室/榻榻米）
- **A/B 布局硬描述（可施工）**：**依赖两处**  
  - `/api/vision` 输出 `layout_options`（含摆位+柜体+动线+灯光+风险）→ 前端展示供选
  - `/api/design/inspire` 把用户选中的 `focus` 作为 `layoutLine`（hard constraint）
- **负向约束（negative constraints）**：**已有且比较强**  
  - 明确排除：`tatami/tea room/shoji windows`、额外窗门、卡通低模、畸变、fisheye、杂乱、毛坯等

### 5.3 “空間分類”稳定性检查点
- 分类端点：`/workspace/api/space.js`
  - 输出强制映射到固定 8 类，并在“primary=其他且候选置信度>=0.45”时提升为候选第 1 名
- 视觉端点：`/workspace/api/vision.js`
  - 如果前端传入 `spaceType`，会强制 `space_type` 与之保持一致（减少“分析说成别的空间”）

---

## 6) 环境变量清单（只列 key 与用途，不含值）

> 来自 `.env.example` + 代码全局扫描 `process.env.*`

### 6.1 生产关键（建议统一）
- **`STEPFUN_API_KEY`（必填）**
  - 用途：`/api/chat`、`/api/vision`、`/api/space`、`/api/design/*`（主流程）
  - 结论：当前代码把它当“统一 key”（最推荐）

### 6.2 可选 / 兼容
- **`STEPFUN_IMAGE_API_KEY`（可选/兼容）**
  - 用途：`/api/generate`（legacy 纯文生图）  
  - 同时 `api/design/inspire.js` 也会用它做 fallback：`STEPFUN_API_KEY || STEPFUN_IMAGE_API_KEY`
- **`STEPFUN_VISION_API_KEY`、`STEPFUN_VISION_API_KEY_2`（可选/兼容）**
  - 用途：仅在 `vision-health` 探活里作为候选 key
- **`ENABLE_DESIGN_SPEC_LLM`（可选开关）**
  - 用途：开启后 `/api/design/generate` 会先用 LLM 生成结构化 spec（更强的可执行 prompt）再 i2i
  - 风险：可能增加时延与不确定性（当前默认为关闭）
- **`BLOB_READ_WRITE_TOKEN`（可选但强烈建议生产配置）**
  - 用途：`/api/upload` 上传图片到 Vercel Blob；`/api/kbStatus`/`services/kbFromBlob.js` 访问知识库
  - 若缺失：前端会退化为 base64 直传 `/api/space`、`/api/vision`（有体积/超时风险）
- **`KB_BLOB_PREFIX`（可选）**
  - 用途：知识库 Blob 前缀（默认 `ningle-temp-images/app知识库/`）
- **`DEEPSEEK_API_KEY`（代码中仅 env-check 暴露布尔，不见实际使用）**

### 6.3 “chat key / vision key / image key 是否同源？”
从代码看，设计目标是 **同源（统一用 `STEPFUN_API_KEY`）**；但存在兼容分裂点：
- `/api/generate` **只认** `STEPFUN_IMAGE_API_KEY`（若生产只配置 `STEPFUN_API_KEY`，该端点会 500）

### 6.4 production/preview/dev 是否一致？
这需要在 Vercel 项目里核对三套环境变量（Production / Preview / Development）。本仓库无法直接读取线上配置；请按“截图清单”提供部署页与 env/日志信息，后续我再做精准对齐建议。

---

## 7) 端到端流程健康检查（本次可验证与待你补充截图部分）

### 7.1 本次已完成的“代码级验证”
- ✅ 追踪了完整数据流（上传→分类→vision→选项→t2i→qa→i2i 精修）
- ✅ 本地 `npm run build` 可成功（依赖安装后）
- ✅ 确认前端请求超时策略：
  - 通用 `fetchJSON`：180s（`services/utils.ts`）
  - `/api/vision` 客户端：300s（`services/visionClient.ts`）
  - `/api/space` 客户端：120s（`services/spaceClient.ts`）
  - `/api/chat` 客户端：180s（`services/chatClient.ts`）

### 7.2 仍需你（King）在浏览器/线上补充的“实际请求/响应记录”
由于本环境无法访问你的线上 Vercel runtime log、也无法代表你完成真实上传交互，我需要你按截图清单提供 Network 面板与页面流程图，才能把“实际请求/响应”逐步写成可复盘的证据链（尤其是超时/429/403 等现场问题）。

---

## 8) Vercel 生产环境检查（现况 + 风险点）

### 8.1 现况（从配置可推断）
- `/api/design/generate` 允许 300s，但 **`/api/vision` 与 `/api/design/inspire` 仍是 60s**  
  → 若 StepFun 视觉分析或 t2i 偶尔超过 60s，线上会出现 504/超时中断（前端即使等 180/300s 也无意义）

### 8.2 图片存储风险
- 若缺 `BLOB_READ_WRITE_TOKEN`：
  - 上传无法得到 public URL，会退化为 base64 直传 API
  - Vercel Serverless 存在 **请求体大小限制** 风险（大图会失败/不稳定）

### 8.3 前端 fetch 超时设置是否过短？
前端超时本身不短（120~300s），真正瓶颈更可能是 Vercel 函数 60s 上限与上游 StepFun 时延/并发限制。

---

## 9) 现有问题列表（按严重度 P0/P1/P2）

### P0（阻断主流程/高概率线上炸）
- **P0-1：Vercel 函数超时不匹配**
  - 现况：`/api/vision`、`/api/design/inspire` 仍受 60s 限制（`vercel.json` 的 `api/**/*`）
  - 风险：视觉分析/文生图在繁忙时很容易超过 60s → 504；前端再长的 timeout 也救不了
- **P0-2：`/api/generate` 可能因缺 key 直接 500**
  - 现况：`api/generate.js` 只读 `STEPFUN_IMAGE_API_KEY`
  - 若生产只配置 `STEPFUN_API_KEY`，则 `/api/generate` 永远报 `MISSING_KEY`

### P1（主流程可跑但体验差/偶发失败/精度明显受影响）
- **P1-1：Blob 未配置时退化为 base64，稳定性下降**
  - 可能引发：请求体过大、网络慢、Vercel body limit、StepFun 上游拉取失败等
- **P1-2：主生成（t2i）对 429（排队）/超时的 UI 解释不够细**
  - `/api/design/inspire` 会返回 `RATE_LIMITED`，但 `App.tsx::triggerGeneration` 当前是统一 `throw`，用户看到会更像“生成失败”，不够明确（精修路径处理得更好）

### P2（非核心/一致性/可维护性）
- **P2-1：KB 状态端点命名本地与线上不一致**
  - 线上：`GET /api/kbStatus`（文件名映射）
  - 本地 dev mock：`GET /api/kb-status`（`vite.config.ts`）
  - 文档：`docs/kb-ops.md` 写的是 `/api/kbStatus`

---

## 10) 建议修正方向（只列方向，先不大改）

> 按你的“最高优先规则”，后续会严格小步提交（每次 1-3 个改动点），先解决 P0，再逐步提升精度。

- **方向 A（P0）：把 `/api/vision` 与 `/api/design/inspire` 的 maxDuration 调整为更符合真实时延的值**  
  - 目标：减少 504/超时中断；与前端 timeout 对齐
- **方向 B（P0）：统一/兼容 key 策略**  
  - 例如让 `/api/generate` 也支持 `STEPFUN_API_KEY` fallback，避免线上误配导致 500
- **方向 C（P1）：让主生成（t2i）对 429/超时给出更清晰的用户提示与可重试策略**
- **方向 D（P1）：进一步增强“香港户型纯文生图”结构锁定层**  
  - 基于你提供的真实 prompt/截图，增强：镜头、尺度、禁豪宅、禁夸张透视、禁跑去日式茶室等，并把 spaceType/A-B 布局更“可施工化”
- **方向 E（P1）：提升空间分类稳定性评估**  
  - 用你提供的真实样本截图/错误例，做最小提示词/阈值调整，而不是大重构

---

## 11) 你需要截图发给我（King → 助手）

请你在 Cursor/浏览器按以下清单截屏（越全越好）：

1) **APP 全流程对话截图（至少 6-8 张）**
   - 上传 → 自动分类按钮 → 选择空间 → 分析完成 → 选布局/尺寸/风格 → 点击“直接生成” → 出图 → 设计说明/再精修

2) **Vercel 部署页（Production）截图**
   - 项目概览页（显示 Production 域名）
   - 最近一次 deployment 详情页（含 Build Logs 与 Function Logs/Runtime Logs，如果有）

3) **“最终 prompt”截图**
   - 至少要包含 `/api/design/inspire` 最终发送到 StepFun 的 `prompt` 文本
   - 如果当前 UI 不显示 prompt：先在浏览器 console 或 Vercel function log 打印 prompt 后截图

4) **Network 面板：/api/vision 与 /api/design/inspire（或 /api/design/generate）的 request/response**
   - 重点截到：
     - request payload（spaceType、focus、roomWidthChi/roomHeightChi、style/color、visionExtraction 是否传到）
     - response（ok、errorCode、耗时、resultUrl）
     - 如有 429/504/500，务必截到 status 与返回体

