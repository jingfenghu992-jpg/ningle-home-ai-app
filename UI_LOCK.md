# UI LOCK
以下元素 **禁止随意改动**（用于保证视觉与交互稳定）：

1. **顶部栏**：`components/AppBar.tsx` 的布局与按钮（“免费跟进”）。
2. **启动页 CTA**：`components/StartScreen.tsx` 的三个主按钮（拍摄/上传/WhatsApp）。
3. **聊天消息渲染**：`components/MessageCard.tsx` 的气泡/选项按钮/加载状态样式。
4. **输入区**：`components/Composer.tsx` 的输入框、上传按钮、发送按钮样式。
5. **整体布局**：`components/AppShell.tsx` 的整体结构（顶部栏 -> 内容区 -> 输入区）。

如果确实要改上述部分，必须先明确“为什么要改”和“预期的视觉基线”，并同步更新 `VISUAL_BASELINE.md`。
