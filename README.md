<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/19ID9QM1_J_xevo60QwQGdZsRvW2k8VXU

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 本地验证指令

1. 启动服务: `npm run dev`
2. 在浏览器 Console 执行以下代码验证 API：

```javascript
// 检查健康状态
fetch('/api/health').then(r=>r.json()).then(console.log)

// 测试文生图 (StepFun)
fetch('/api/generate',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
    prompt:'现代简约客厅，浅色木地板，收纳电视柜，暖白灯光',
    size:'1024x1024'
  })
}).then(r=>r.json()).then(console.log)
```
