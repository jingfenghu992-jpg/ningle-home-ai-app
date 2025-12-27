<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 运行与部署

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/19ID9QM1_J_xevo60QwQGdZsRvW2k8VXU

## 本地运行

**Prerequisites:**  Node.js


1. 安装依赖：`npm install`
2. 配置环境变量（建议新建 `.env.local`）：
   - `STEPFUN_API_KEY`（必填）：用于聊天/视觉/效果图
   - `BLOB_READ_WRITE_TOKEN`（可选）：用于图片上传到 Vercel Blob（拿到稳定的公开 URL）与知识库（Blob 上的 `.doc/.docx`）
   - `KB_BLOB_PREFIX`（可选）：知识库 Blob 前缀（默认 `ningle-temp-images/app知识库/`）
3. 启动：`npm run dev`

## 本地验证指令

1. 启动服务: `npm run dev`
2. 在浏览器 Console 执行以下代码验证 API：

```javascript
// 检查健康状态
fetch('/api/health').then(r=>r.json()).then(console.log)

// 检查环境变量配置（不会泄露密钥，只返回布尔值）
fetch('/api/env-check').then(r=>r.json()).then(console.log)

// 测试文生图 (StepFun)
fetch('/api/generate',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
    prompt:'现代简约客厅，浅色木地板，收纳电视柜，暖白灯光',
    size:'1024x1024'
  })
}).then(r=>r.json()).then(console.log)

// 测试图片空间分类（把 imageUrl 换成你自己的公开图片 URL 或 dataUrl）
// fetch('/api/space',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ imageUrl }) }).then(r=>r.json()).then(console.log)
```
