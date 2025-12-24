import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from './components/AppShell';
import { AppBar } from './components/AppBar';
import { PhotoCard } from './components/PhotoCard';
import { NextStepCard } from './components/NextStepCard';
import { SummaryCard } from './components/SummaryCard';
import { MessageCard } from './components/MessageCard';
import { RenderResultCard } from './components/RenderResultCard';
import { Composer } from './components/Composer';
import { Message } from './types';
import { INITIAL_MESSAGE } from './constants';
import { analyzeImage } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateDesignImage, uploadImage } from './services/generateClient';
import { compressImage } from './services/utils';

// Helper: Parse render intent
function hasRenderIntent(text: string): boolean {
  const keywords = ['效果圖', '效果图', '出圖', '出图', '渲染', '設計圖', '设计图', '3d圖', '3d图', '想睇下', '想看一下'];
  return keywords.some(k => text.includes(k));
}

const App: React.FC = () => {
  // --- Data & State ---
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [appState, setAppState] = useState<'IDLE' | 'WAITING_FOR_SPACE' | 'ANALYZING' | 'RENDER_INTAKE' | 'GENERATING_RENDER' | 'REVISION_LOOP'>('IDLE');
  
  const [pendingImage, setPendingImage] = useState<{dataUrl: string, blobUrl?: string} | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(null);
  
  const [renderData, setRenderData] = useState<{
    space?: string;
    style?: string;
    color?: string;
    requirements?: string;
    step: 'style' | 'color' | 'requirements' | 'ready'; 
  }>({ step: 'style' });

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll on message change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Typewriter Logic ---
  const [typewriterBuffer, setTypewriterBuffer] = useState<{msgId: string, queue: string[]} | null>(null);

  useEffect(() => {
      if (!typewriterBuffer || typewriterBuffer.queue.length === 0) return;
      const timer = setInterval(() => {
          setTypewriterBuffer(prev => {
              if (!prev || prev.queue.length === 0) return null;
              const nextChar = prev.queue[0];
              const remaining = prev.queue.slice(1);
              setMessages(current => current.map(m => m.id === prev.msgId ? { ...m, content: m.content + nextChar } : m));
              return { ...prev, queue: remaining };
          });
      }, 15);
      return () => clearInterval(timer);
  }, [typewriterBuffer]);

  const streamToTypewriter = (msgId: string, chunk: string) => {
      setTypewriterBuffer(prev => {
          const chars = chunk.split('');
          if (prev && prev.msgId === msgId) return { ...prev, queue: [...prev.queue, ...chars] };
          return { msgId, queue: chars };
      });
  };

  // --- Handlers ---
  const handleSendMessage = async (text: string) => {
    const userMsg: Message = { id: Date.now().toString(), type: 'text', content: text, sender: 'user', timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    // WAITING FOR SPACE
    if (appState === 'WAITING_FOR_SPACE') {
        if (pendingImage) {
            setAppState('ANALYZING');
            await performAnalysisAndSuggestions(pendingImage.dataUrl, pendingImage.blobUrl, text);
            setAppState('IDLE');
            return;
        }
        setAppState('IDLE');
    }

    // RENDER INTAKE
    if (appState === 'RENDER_INTAKE') {
        processRenderIntake(text);
        return;
    }

    // REVISION LOOP
    if (lastGeneratedImage && (text.includes('再改') || text.includes('修改') || text.includes('唔係好') || text.includes('轉'))) {
        setAppState('REVISION_LOOP');
        await triggerImageGeneration(renderData, pendingImage?.blobUrl, lastGeneratedImage, text);
        setAppState('IDLE');
        return;
    }

    // TRIGGER RENDER
    if (hasRenderIntent(text)) {
        const lastImageMsg = messages.slice().reverse().find(m => m.type === 'image');
        const baseBlobUrl = pendingImage?.blobUrl || (lastImageMsg?.content?.startsWith('http') ? lastImageMsg.content : undefined);

        if (!baseBlobUrl) {
             addAiMessage('想出效果圖無問題！麻煩你上載一張現場相片先。📸');
             return;
        }

        if (!pendingImage && baseBlobUrl) setPendingImage({ dataUrl: baseBlobUrl, blobUrl: baseBlobUrl });

        setAppState('RENDER_INTAKE');
        setRenderData({ step: 'style' }); 
        addAiMessage('收到！想幫你出張效果圖。首先確認下，你想行咩風格？', ['現代簡約', '北歐風', '日系木調', '輕奢風', '奶油風']);
        return;
    }

    // NORMAL CHAT
    await performNormalChat(text);
  };

  const addAiMessage = (content: string, options?: string[]) => {
      const msg: Message = { id: Date.now().toString(), type: 'text', content, sender: 'ai', timestamp: Date.now(), options };
      setMessages(prev => [...prev, msg]);
  };

  const performNormalChat = async (text: string) => {
      const aiMsgId = Date.now().toString() + 'ai';
      setMessages(prev => [...prev, { id: aiMsgId, type: 'text', content: '', sender: 'ai', timestamp: Date.now() }]);

      try {
        const history = messages.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content } as any));
        history.push({ role: 'user', content: text });

        for await (const chunk of chatWithDeepseekStream({ mode: 'consultant', text, messages: history })) {
            streamToTypewriter(aiMsgId, chunk);
        }
      } catch (e) {
          console.error(e);
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '系統繁忙，請稍後再試。' } : m));
      }
  };

  const performAnalysisAndSuggestions = async (imageDataUrl: string, imageBlobUrl: string | undefined, spaceType: string) => {
      // Show analyzing in chat stream? Or just status card? 
      // User asked for "SummaryCard" with analysis.
      // Let's also stream the suggestions to chat.
      const aiMsgId = Date.now().toString() + 'vis';
      setMessages(prev => [...prev, { id: aiMsgId, type: 'text', content: '收到，正在分析空間結構… 🔍', sender: 'ai', timestamp: Date.now() }]);

      try {
          const visionRes = await analyzeImage({ imageDataUrl, imageUrl: imageBlobUrl, mode: 'consultant', spaceType } as any);

          if (visionRes.ok && visionRes.vision_summary) {
               setAnalysisSummary(visionRes.vision_summary); // Populate Summary Card
               setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '' } : m)); // Clear placeholder
               
               const prompt = `用戶上傳了圖片，空間是「${spaceType}」。視覺分析結果：${visionRes.vision_summary}。請針對此空間提供 3-4 個針對香港細單位的具體全屋訂造/收納建議。請用精簡 Point Form。`;
               
               for await (const chunk of chatWithDeepseekStream({ mode: 'consultant', text: prompt, messages: [], visionSummary: visionRes.vision_summary })) {
                   streamToTypewriter(aiMsgId, chunk);
               }
          } else {
              setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '分析失敗，請重試。' } : m));
          }
      } catch (e) {
          console.error(e);
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '系統錯誤，請重試。' } : m));
      }
  };

  const processRenderIntake = (answer: string) => {
      const nextData = { ...renderData };
      let replyContent = '';
      let options: string[] | undefined;

      switch (renderData.step) {
          case 'style':
              nextData.style = answer;
              nextData.step = 'color';
              replyContent = '明白。色系方面有無特別喜好？';
              options = ['淺木色', '深木色', '白色為主', '黑白灰', '暖灰色'];
              break;
          case 'color':
              nextData.color = answer;
              nextData.step = 'requirements';
              replyContent = '收到。最後，有無咩核心櫃體或特別要求？';
              break;
          case 'requirements':
              nextData.requirements = answer;
              nextData.step = 'ready';
              replyContent = '資料齊全！我可以幫你生成效果圖喇。請確認是否開始？';
              options = ['生成效果圖'];
              break;
      }
      setRenderData(nextData);
      addAiMessage(replyContent, options);
  };

  const triggerImageGeneration = async (data: any, baseBlobUrl: string | undefined, lastUrl: string | undefined, revision?: string) => {
      const aiMsgId = Date.now().toString() + 'gen';
      // Use a temporary message to show loading state
      setMessages(prev => [...prev, { id: aiMsgId, type: 'text', content: '收到，我依家幫你設計緊張效果圖，請稍等… 🎨', sender: 'ai', timestamp: Date.now() }]);

      try {
          const payload = {
              prompt: '', renderIntake: { ...data }, baseImageBlobUrl: lastUrl || baseBlobUrl, size: '1024x1024'
          };
          if (revision && payload.renderIntake) payload.renderIntake.requirements += ` Modification: ${revision}`;

          const res = await generateDesignImage(payload as any);

          if (res.ok && (res.resultBlobUrl || res.b64_json)) {
              const resultUrl = res.resultBlobUrl || (res.b64_json ? `data:image/jpeg;base64,${res.b64_json}` : null);
              
              setMessages(prev => prev.filter(m => m.id !== aiMsgId)); // Remove loading
              
              // Add Special Result Card in Stream (using RenderResultCard component inside message stream logic? 
              // Actually better to push a message that triggers the card, or just push a message with type='image' and handle it customly)
              // Let's use a message type='image' but the MessageCard component will ignore it, and we render RenderResultCard manually?
              // Or better, add a special message type.
              // For now, let's keep it simple: Add message type='render_result' (we need to cast or ignore TS for quick fix)
              
              // We'll use type='image' but with content as the URL. 
              // And we can update `MessageCard` to render `RenderResultCard` if we want, OR just render it in the list.
              // But `MessageCard` currently returns null for image. 
              // We should update `MessageCard` or handle it in App.tsx map.
              
              const resultMsg: Message = {
                  id: Date.now().toString(),
                  type: 'image', // We will intercept this in render loop
                  content: resultUrl!,
                  sender: 'ai',
                  timestamp: Date.now()
              };
              setMessages(prev => [...prev, resultMsg]);
              setLastGeneratedImage(resultUrl!);
          } else {
              throw new Error(res.message);
          }
      } catch (e: any) {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: `出圖遇到問題：${e.message || '請重試'}`, options: ['重試生成'] } : m));
      }
  };

  const handleSendImage = (file: File) => {
      compressImage(file, 1536, 0.8).then(blob => {
          const reader = new FileReader();
          reader.onload = async (e) => {
              const dataUrl = e.target?.result as string;
              
              // Optimistic UI
              setPendingImage({ dataUrl, blobUrl: '' }); // Blob url comes later
              setAppState('WAITING_FOR_SPACE');
              
              // Upload
              try {
                  const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
                  const upRes = await uploadImage(compressedFile);
                  if (upRes?.url) setPendingImage(prev => prev ? { ...prev, blobUrl: upRes.url } : null);
              } catch (err) { console.error(err); }
          };
          reader.readAsDataURL(blob);
      });
  };

  const handleOptionClick = (opt: string) => {
      if (opt === '生成效果圖') {
          setAppState('GENERATING_RENDER');
          setMessages(prev => [...prev, { id: Date.now().toString(), type: 'text', content: opt, sender: 'user', timestamp: Date.now() }]);
          triggerImageGeneration(renderData, pendingImage?.blobUrl, undefined);
      } else {
          handleSendMessage(opt);
      }
  };

  // Determine Main Photo Status
  const getPhotoStatus = () => {
      if (appState === 'WAITING_FOR_SPACE') return 'waiting';
      if (appState === 'ANALYZING') return 'analyzing';
      if (appState === 'GENERATING_RENDER') return 'rendering';
      return 'done';
  };

  return (
    <AppShell>
      <AppBar />
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-none">
        
        {/* Top Workspace Area */}
        <div className="pt-2 pb-4">
            {/* Show PhotoCard if we have an active image */}
            {(pendingImage || lastGeneratedImage) && (
                <PhotoCard 
                    imageUrl={lastGeneratedImage || pendingImage!.dataUrl} 
                    status={getPhotoStatus()}
                    timestamp={Date.now()}
                    onExpand={() => { /* TODO: Lightbox */ }}
                />
            )}

            {/* Next Step Hint */}
            {appState === 'WAITING_FOR_SPACE' && (
                <NextStepCard text="收到～想確認一下：呢張相係邊個空間？（例如：客廳/睡房/廚房/玄關/書房/其他）" />
            )}

            {/* Analysis Summary */}
            {analysisSummary && <SummaryCard summary={analysisSummary} />}
        </div>

        {/* Conversation Stream */}
        <div className="pb-4">
            {messages.map((msg) => {
                if (msg.type === 'image' && msg.sender === 'ai') {
                    // It's a Render Result
                    return (
                        <RenderResultCard 
                            key={msg.id} 
                            imageUrl={msg.content} 
                            onModify={() => handleSendMessage('我想改...')} 
                            onWhatsApp={() => window.open('https://wa.me/85212345678', '_blank')} 
                        />
                    );
                }
                // Skip user uploaded image messages in stream if they are shown in PhotoCard? 
                // User requirement: "Conversation (Proposal Card style)..."
                // Let's keep text messages.
                if (msg.type === 'image' && msg.sender === 'user') return null; 

                return <MessageCard key={msg.id} message={msg} onOptionClick={handleOptionClick} />;
            })}
            <div ref={chatEndRef} />
        </div>

      </div>

      <Composer onSendMessage={handleSendMessage} onSendImage={handleSendImage} disabled={appState === 'ANALYZING' || appState === 'GENERATING_RENDER'} />
    </AppShell>
  );
};

export default App;
