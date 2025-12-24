import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import InputBar from './components/InputBar';
import MessageBubble from './components/MessageBubble';
import { Message } from './types';
import { INITIAL_MESSAGE } from './constants';
import { analyzeImage } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateDesignImage, uploadImage } from './services/generateClient';
import { compressImage } from './services/utils';

// Helper: Parse render intent from user message
function hasRenderIntent(text: string): boolean {
  const keywords = ['效果圖', '效果图', '出圖', '出图', '渲染', '設計圖', '设计图', '3d圖', '3d图', '想睇下', '想看一下'];
  return keywords.some(k => text.includes(k));
}

const App: React.FC = () => {
  // Single chat history state
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Pending image for vision analysis
  const [pendingImage, setPendingImage] = useState<{dataUrl: string, blobUrl?: string} | null>(null);
  
  // Render Intake State (Chat-based Flow)
  const [renderState, setRenderState] = useState<{
    isActive: boolean;
    step: 'space' | 'style' | 'color' | 'requirements' | 'ready';
    data: {
      space?: string;
      style?: string;
      color?: string;
      requirements?: string;
    };
    baseImageBlobUrl?: string; // Original photo
    lastGeneratedImageUrl?: string; // For "re-edit" flow
  }>({
    isActive: false,
    step: 'space',
    data: {}
  });

  const [generating, setGenerating] = useState(false);

  // Scroll to bottom
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle User Text Input
  const handleSendMessage = async (text: string) => {
    // 1. Add User Message
    const userMsg: Message = {
      id: Date.now().toString(),
      type: 'text',
      content: text,
      sender: 'user',
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);

    // 2. Check for "Re-edit" Intent (if we have a last generated image)
    if (renderState.lastGeneratedImageUrl && (text.includes('再改') || text.includes('修改') || text.includes('唔係好') || text.includes('不如'))) {
        setGenerating(true);
        triggerImageGeneration(renderState.data, renderState.baseImageBlobUrl, renderState.lastGeneratedImageUrl, text);
        return;
    }

    // 3. Render Intake Flow (State Machine)
    if (renderState.isActive && renderState.step !== 'ready') {
      processRenderIntake(text);
      return;
    }

    // 4. Trigger Render Intake (if keywords found & image exists)
    if (hasRenderIntent(text)) {
      // Must have uploaded an image first to establish "scene context"
      // Or we check if there is any image in history?
      // For simplicity, let's check if we have a valid baseImage in state (from previous uploads)
      // or we ask user to upload one.
      
      const lastImageMsg = messages.slice().reverse().find(m => m.type === 'image');
      const baseBlobUrl = renderState.baseImageBlobUrl || (lastImageMsg?.content?.startsWith('http') ? lastImageMsg.content : undefined);

      if (!baseBlobUrl && !pendingImage) {
         const reply: Message = {
           id: Date.now().toString() + 'r',
           type: 'text',
           content: '想出效果圖無問題！麻煩你上載一張現場相片先，等我可以跟返實際結構去設計。📸',
           sender: 'ai',
           timestamp: Date.now()
         };
         setMessages(prev => [...prev, reply]);
         return;
      }

      // Start Intake
      setRenderState(prev => ({
        ...prev,
        isActive: true,
        step: 'space',
        baseImageBlobUrl: baseBlobUrl || prev.baseImageBlobUrl
      }));
      
      const reply: Message = {
        id: Date.now().toString() + 'r',
        type: 'text',
        content: '收到！想幫你出張效果圖。首先確認下，呢個係邊個空間？（例如：客廳、睡房、廚房…）',
        sender: 'ai',
        timestamp: Date.now(),
        options: ['客廳', '飯廳', '主人房', '睡房', '廚房', '書房']
      };
      setMessages(prev => [...prev, reply]);
      return;
    }

    // 5. Normal Chat (Consultant Mode)
    // Add AI Placeholder
    const aiMsgId = Date.now().toString() + 'ai';
    const aiPlaceholder: Message = {
      id: aiMsgId,
      type: 'text',
      content: '...',
      sender: 'ai',
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, aiPlaceholder]);

    try {
      let fullContent = '';
      const apiMessages = messages.map(m => ({
        role: m.sender === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content
      }));
      // Add current user message
      apiMessages.push({ role: 'user', content: text });

      // If we have a pending image analysis (vision summary), pass it
      // Note: We don't store visionSummary in state heavily, usually rely on chat history context
      // But for the immediate turn after upload, it's passed via `visionSummary` prop.
      // Here we assume vision summary is already part of the conversation context if it was outputted by AI previously.
      
      await (async () => {
        for await (const chunk of chatWithDeepseekStream({
          mode: 'consultant', // Always consultant now
          text: text,
          messages: apiMessages
        })) {
          fullContent += chunk;
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: fullContent } : m));
        }
      })();
    } catch (error: any) {
      console.error('Chat Error:', error);
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '系統繁忙，請稍後再試。' } : m));
    }
  };

  const processRenderIntake = (answer: string) => {
    const nextState = { ...renderState };
    let replyContent = '';
    let options: string[] | undefined;

    switch (renderState.step) {
      case 'space':
        nextState.data.space = answer;
        nextState.step = 'style';
        replyContent = '好嘅。你想行咩風格？';
        options = ['現代簡約', '北歐風', '日系木調', '輕奢風', '奶油風'];
        break;
      case 'style':
        nextState.data.style = answer;
        nextState.step = 'color';
        replyContent = '明白。色系方面有無特別喜好？';
        options = ['淺木色', '深木色', '白色為主', '黑白灰', '暖灰色'];
        break;
      case 'color':
        nextState.data.color = answer;
        nextState.step = 'requirements';
        replyContent = '收到。最後，有無咩核心櫃體或特別要求？（例如：想要到頂衣櫃、C字鞋櫃、避開窗台位…）';
        break;
      case 'requirements':
        nextState.data.requirements = answer;
        nextState.step = 'ready';
        replyContent = '資料齊全！我可以幫你生成效果圖喇。請確認是否開始？';
        options = ['生成效果圖'];
        break;
    }

    setRenderState(nextState);
    const reply: Message = {
      id: Date.now().toString(),
      type: 'text',
      content: replyContent,
      sender: 'ai',
      timestamp: Date.now(),
      options
    };
    setMessages(prev => [...prev, reply]);
  };

  // Handle Option Click
  const handleOptionClick = (opt: string) => {
    if (opt === '生成效果圖') {
      // Trigger Generation
      setGenerating(true);
      const userMsg: Message = {
        id: Date.now().toString(),
        type: 'text',
        content: opt,
        sender: 'user',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, userMsg]);
      
      triggerImageGeneration(renderState.data, renderState.baseImageBlobUrl, undefined);
    } else {
      handleSendMessage(opt);
    }
  };

  // Trigger Image Generation
  const triggerImageGeneration = async (
      data: any, 
      baseBlobUrl?: string, 
      lastGeneratedUrl?: string, 
      revisionPrompt?: string
  ) => {
    if (!baseBlobUrl && !lastGeneratedUrl) {
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            type: 'text',
            content: '系統搵唔到底圖，請重新上傳相片。',
            sender: 'ai',
            timestamp: Date.now()
        }]);
        setGenerating(false);
        return;
    }

    const aiMsgId = Date.now().toString() + 'gen';
    setMessages(prev => [...prev, {
        id: aiMsgId,
        type: 'text',
        content: '收到，我依家幫你設計緊張效果圖，請稍等… 🎨',
        sender: 'ai',
        timestamp: Date.now()
    }]);

    try {
        // Construct Prompt
        const space = data.space || 'interior';
        const style = data.style || 'modern';
        const color = data.color || 'light';
        const reqs = data.requirements || '';
        const revision = revisionPrompt ? ` Modification: ${revisionPrompt}` : '';
        
        const prompt = `Realistic interior design render of ${space}, ${style} style, ${color} color scheme. ${reqs}. ${revision}. Keep structural elements unchanged. High quality, photorealistic.`;

        // Use last generated image as base if available (img2img loop), else use original photo
        const sourceUrl = lastGeneratedUrl || baseBlobUrl;

        if (!sourceUrl) throw new Error("No source image URL");

        const res = await generateDesignImage({
            prompt,
            baseImageBlobUrl: sourceUrl,
            size: '1024x1024'
        });

        if (res.ok && (res.resultBlobUrl || res.b64_json)) {
            const resultUrl = res.resultBlobUrl || (res.b64_json ? `data:image/jpeg;base64,${res.b64_json}` : null);
            
            if (resultUrl) {
                // Remove placeholder
                setMessages(prev => prev.filter(m => m.id !== aiMsgId));
                
                // Add Image Message
                const imgMsg: Message = {
                    id: Date.now().toString(),
                    type: 'image',
                    content: resultUrl,
                    sender: 'ai',
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, imgMsg]);

                // Add Follow-up Text
                const followUp: Message = {
                    id: Date.now().toString() + 'fu',
                    type: 'text',
                    content: '呢個設計你覺得點？如果想微調（例如轉色、改櫃款），可以直接同我講「再改...」。😊',
                    sender: 'ai',
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, followUp]);

                // Update State for next loop
                setRenderState(prev => ({
                    ...prev,
                    lastGeneratedImageUrl: resultUrl,
                    // keep baseImageBlobUrl as original
                }));
            } else {
                throw new Error("No image URL returned");
            }
        } else {
            throw new Error(res.message || "Generation failed");
        }

    } catch (error: any) {
        console.error('Generation Error:', error);
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
            ...m, 
            content: `出圖遇到問題：${error.message || '請稍後再試'}。`,
            options: ['重試生成']
        } : m));
    } finally {
        setGenerating(false);
    }
  };

  // Handle Image Upload
  const handleSendImage = (file: File) => {
    // 1. Compress
    compressImage(file, 1536, 0.8).then(blob => {
        const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            
            // Add User Image Msg
            const msgId = Date.now().toString();
            setMessages(prev => [...prev, {
                id: msgId,
                type: 'image',
                content: dataUrl,
                sender: 'user',
                timestamp: Date.now()
            }]);

            // Add AI Placeholder
            const aiMsgId = Date.now().toString() + 'ai';
            setMessages(prev => [...prev, {
                id: aiMsgId,
                type: 'text',
                content: '收到相片，正在分析空間結構… 🔍',
                sender: 'ai',
                timestamp: Date.now()
            }]);

            // Upload to Blob (Background)
            let blobUrl = '';
            try {
                const uploadRes = await uploadImage(compressedFile);
                if (uploadRes?.url) {
                    blobUrl = uploadRes.url;
                    // Update state if we need this for later rendering
                    setRenderState(prev => ({ ...prev, baseImageBlobUrl: blobUrl }));
                }
            } catch (err) {
                console.error('Upload failed:', err);
            }

            // Vision Analysis
            try {
                const visionRes = await analyzeImage({
                    imageDataUrl: dataUrl,
                    imageUrl: blobUrl || undefined,
                    mode: 'consultant' // Use generic mode
                });

                if (visionRes.ok && visionRes.vision_summary) {
                    // Update Placeholder with Analysis
                    setMessages(prev => prev.map(m => m.id === aiMsgId ? {
                        ...m,
                        content: `【空間分析】\n${visionRes.vision_summary}\n\n💡 我建議可以咁樣設計：\n(正在生成建議...)`
                    } : m));

                    // Generate Advice via Chat API
                    let fullAdvice = '';
                    const adviceMsgId = Date.now().toString() + 'adv';
                    setMessages(prev => [...prev, {
                        id: adviceMsgId,
                        type: 'text',
                        content: '...',
                        sender: 'ai',
                        timestamp: Date.now()
                    }]);

                    for await (const chunk of chatWithDeepseekStream({
                        mode: 'consultant',
                        text: `用戶上傳了圖片。視覺分析結果：${visionRes.vision_summary}。請根據此分析，提供3-4個針對香港細單位的具體全屋訂造/收納建議。`,
                        messages: [],
                        visionSummary: visionRes.vision_summary
                    })) {
                        fullAdvice += chunk;
                        setMessages(prev => prev.map(m => m.id === adviceMsgId ? { ...m, content: fullAdvice } : m));
                    }
                    
                    // Add "Render" Prompt
                    setTimeout(() => {
                        setMessages(prev => [...prev, {
                            id: Date.now().toString() + 'p',
                            type: 'text',
                            content: '如果你想睇下實際效果，可以同我講「想出圖」，我幫你生成效果圖！✨',
                            sender: 'ai',
                            timestamp: Date.now(),
                            options: ['想要效果圖']
                        }]);
                    }, 1000);

                } else {
                    throw new Error(visionRes.message || '無法識別圖片');
                }
            } catch (error: any) {
                setMessages(prev => prev.map(m => m.id === aiMsgId ? {
                    ...m,
                    content: `圖片分析失敗：${error.message}。請試下重傳清晰啲嘅相。`
                } : m));
            }
        };
        reader.readAsDataURL(blob);
    });
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--wa-bg)] overflow-hidden">
      <Header />
      <div className="flex-1 overflow-y-auto px-4 py-1 chat-bg-container relative">
        <div className="flex flex-col gap-1 pb-2 relative z-10">
            {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onOptionClick={handleOptionClick} />
            ))}
            <div ref={chatEndRef} />
        </div>
      </div>
      <InputBar onSendMessage={handleSendMessage} onSendImage={handleSendImage} />
    </div>
  );
};

export default App;
