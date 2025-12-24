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

function hasRenderIntent(text: string): boolean {
  const keywords = ['效果圖', '效果图', '出圖', '出图', '渲染', '設計圖', '设计图', '3d圖', '3d图', '想睇下', '想看一下'];
  return keywords.some(k => text.includes(k));
}

const App: React.FC = () => {
  // Chat History
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // State Machine
  const [appState, setAppState] = useState<'IDLE' | 'WAITING_FOR_SPACE' | 'ANALYZING' | 'RENDER_INTAKE' | 'GENERATING_RENDER' | 'REVISION_LOOP'>('IDLE');
  
  // Data Stores
  const [pendingImage, setPendingImage] = useState<{dataUrl: string, blobUrl?: string} | null>(null);
  const [renderData, setRenderData] = useState<{
    space?: string;
    style?: string;
    color?: string;
    requirements?: string;
    step: 'style' | 'color' | 'requirements' | 'ready'; 
  }>({ step: 'style' });
  
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(null);

  // Scroll to bottom
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Typewriter Buffer Queue
  const [typewriterBuffer, setTypewriterBuffer] = useState<{msgId: string, queue: string[]} | null>(null);

  // Effect to drain the typewriter buffer
  useEffect(() => {
      if (!typewriterBuffer || typewriterBuffer.queue.length === 0) return;

      const timer = setInterval(() => {
          setTypewriterBuffer(prev => {
              if (!prev || prev.queue.length === 0) return null;
              
              const nextChar = prev.queue[0];
              const remaining = prev.queue.slice(1);
              
              setMessages(currentMessages => currentMessages.map(m => {
                  if (m.id === prev.msgId) {
                      return { ...m, content: m.content + nextChar };
                  }
                  return m;
              }));

              return { ...prev, queue: remaining };
          });
      }, 15); // Fast typing speed

      return () => clearInterval(timer);
  }, [typewriterBuffer]);

  const streamToTypewriter = (msgId: string, chunk: string) => {
      setTypewriterBuffer(prev => {
          const chars = chunk.split('');
          if (prev && prev.msgId === msgId) {
              return { ...prev, queue: [...prev.queue, ...chars] };
          }
          return { msgId, queue: chars };
      });
  };

  // Main Handler
  const handleSendMessage = async (text: string) => {
    // 1. User Message
    const userMsg: Message = {
      id: Date.now().toString(),
      type: 'text',
      content: text,
      sender: 'user',
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);

    // State Machine Logic
    
    // STATE: WAITING_FOR_SPACE
    if (appState === 'WAITING_FOR_SPACE') {
        if (pendingImage) {
            setAppState('ANALYZING');
            await performAnalysisAndSuggestions(pendingImage.dataUrl, pendingImage.blobUrl, text); // text is space name
            setAppState('IDLE');
            return;
        } else {
            setAppState('IDLE');
        }
    }

    // STATE: RENDER_INTAKE
    if (appState === 'RENDER_INTAKE') {
        processRenderIntake(text);
        return;
    }

    // STATE: REVISION_LOOP (Implicit check via Intent)
    if (lastGeneratedImage && (text.includes('再改') || text.includes('修改') || text.includes('唔係好') || text.includes('不如') || text.includes('轉'))) {
        setAppState('REVISION_LOOP');
        await triggerImageGeneration(renderData, pendingImage?.blobUrl, lastGeneratedImage, text);
        setAppState('IDLE');
        return;
    }

    // TRIGGER: RENDER INTAKE
    if (hasRenderIntent(text)) {
        const lastImageMsg = messages.slice().reverse().find(m => m.type === 'image');
        const baseBlobUrl = pendingImage?.blobUrl || (lastImageMsg?.content?.startsWith('http') ? lastImageMsg.content : undefined);

        if (!baseBlobUrl) {
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

        if (!pendingImage && baseBlobUrl) {
            setPendingImage({ dataUrl: baseBlobUrl, blobUrl: baseBlobUrl });
        }

        setAppState('RENDER_INTAKE');
        setRenderData({ step: 'style' }); 
        
        const reply: Message = {
            id: Date.now().toString() + 'q1',
            type: 'text',
            content: '收到！想幫你出張效果圖。首先確認下，你想行咩風格？（例如：現代簡約/北歐/日系/輕奢/奶油風）',
            sender: 'ai',
            timestamp: Date.now(),
            options: ['現代簡約', '北歐風', '日系木調', '輕奢風', '奶油風']
        };
        setMessages(prev => [...prev, reply]);
        return;
    }

    // STATE: IDLE (Normal Chat)
    await performNormalChat(text);
  };

  const performNormalChat = async (text: string) => {
      const aiMsgId = Date.now().toString() + 'ai';
      setMessages(prev => [...prev, {
          id: aiMsgId,
          type: 'text',
          content: '',
          sender: 'ai',
          timestamp: Date.now()
      }]);

      try {
        const history = messages.map(m => ({
            role: m.sender === 'user' ? 'user' as const : 'assistant' as const,
            content: m.content
        }));
        history.push({ role: 'user', content: text });

        for await (const chunk of chatWithDeepseekStream({
            mode: 'consultant',
            text: text,
            messages: history
        })) {
            streamToTypewriter(aiMsgId, chunk);
        }
      } catch (e) {
          console.error(e);
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '系統繁忙，請稍後再試。' } : m));
      }
  };

  const performAnalysisAndSuggestions = async (imageDataUrl: string, imageBlobUrl: string | undefined, spaceType: string) => {
      // 1. Vision Analysis
      const aiMsgId = Date.now().toString() + 'vis';
      setMessages(prev => [...prev, {
          id: aiMsgId,
          type: 'text',
          content: '收到，正在分析空間結構… 🔍', 
          sender: 'ai',
          timestamp: Date.now()
      }]);

      try {
          const visionRes = await analyzeImage({
              imageDataUrl: imageDataUrl,
              imageUrl: imageBlobUrl,
              mode: 'consultant',
              spaceType: spaceType
          } as any);

          if (visionRes.ok && visionRes.vision_summary) {
               setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '' } : m));
               
               const prompt = `用戶上傳了圖片，空間是「${spaceType}」。視覺分析結果：${visionRes.vision_summary}。請針對此空間提供 3-4 個針對香港細單位的具體全屋訂造/收納建議。請用精簡 Point Form。`;
               
               for await (const chunk of chatWithDeepseekStream({
                   mode: 'consultant',
                   text: prompt,
                   messages: [],
                   visionSummary: visionRes.vision_summary
               })) {
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
              replyContent = '明白。色系方面有無特別喜好？（例如：淺木/深木/白/灰/暖色）';
              options = ['淺木色', '深木色', '白色為主', '黑白灰', '暖灰色'];
              break;
          case 'color':
              nextData.color = answer;
              nextData.step = 'requirements';
              replyContent = '收到。最後，有無咩核心櫃體或特別要求？（例如：到頂衣櫃/C字鞋櫃/避開窗台位…）';
              break;
          case 'requirements':
              nextData.requirements = answer;
              nextData.step = 'ready';
              replyContent = '資料齊全！我可以幫你生成效果圖喇。請確認是否開始？';
              options = ['生成效果圖'];
              break;
      }
      
      setRenderData(nextData);
      setMessages(prev => [...prev, {
          id: Date.now().toString(),
          type: 'text',
          content: replyContent,
          sender: 'ai',
          timestamp: Date.now(),
          options
      }]);
  };

  const triggerImageGeneration = async (data: any, baseBlobUrl: string | undefined, lastUrl: string | undefined, revision?: string) => {
      const aiMsgId = Date.now().toString() + 'gen';
      setMessages(prev => [...prev, {
          id: aiMsgId,
          type: 'text',
          content: '收到，我依家幫你設計緊張效果圖，請稍等… 🎨',
          sender: 'ai',
          timestamp: Date.now()
      }]);

      try {
          const payload = {
              prompt: '', 
              renderIntake: { ...data }, 
              baseImageBlobUrl: lastUrl || baseBlobUrl,
              size: '1024x1024'
          };
          
          if (revision && payload.renderIntake) {
              payload.renderIntake.requirements += ` Modification: ${revision}`;
          }

          const res = await generateDesignImage(payload as any);

          if (res.ok && (res.resultBlobUrl || res.b64_json)) {
              const resultUrl = res.resultBlobUrl || (res.b64_json ? `data:image/jpeg;base64,${res.b64_json}` : null);
              
              setMessages(prev => prev.filter(m => m.id !== aiMsgId)); 
              
              setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  type: 'image',
                  content: resultUrl!,
                  sender: 'ai',
                  timestamp: Date.now()
              }]);
              
              setMessages(prev => [...prev, {
                  id: Date.now().toString() + 'fu',
                  type: 'text',
                  content: '呢個設計你覺得點？如果想微調（例如轉色、改櫃款），可以直接同我講「再改...」。😊',
                  sender: 'ai',
                  timestamp: Date.now()
              }]);
              
              setLastGeneratedImage(resultUrl);
          } else {
              throw new Error(res.message);
          }
      } catch (e: any) {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
              ...m, 
              content: `出圖遇到問題：${e.message || '請重試'}`,
              options: ['重試生成']
           } : m));
      }
  };

  const handleSendImage = (file: File) => {
      compressImage(file, 1536, 0.8).then(blob => {
          const reader = new FileReader();
          reader.onload = async (e) => {
              const dataUrl = e.target?.result as string;
              
              setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  type: 'image',
                  content: dataUrl,
                  sender: 'user',
                  timestamp: Date.now()
              }]);

              let blobUrl = '';
              try {
                  const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
                  const upRes = await uploadImage(compressedFile);
                  if (upRes?.url) blobUrl = upRes.url;
              } catch (err) {
                  console.error('Upload fail', err);
              }

              setPendingImage({ dataUrl, blobUrl });
              setAppState('WAITING_FOR_SPACE');

              setMessages(prev => [...prev, {
                  id: Date.now().toString() + 'ask',
                  type: 'text',
                  content: '收到～想確認一下：呢張相係邊個空間？（例如：客廳/睡房/廚房/玄關/書房/其他）',
                  sender: 'ai',
                  timestamp: Date.now()
              }]);
          };
          reader.readAsDataURL(blob);
      });
  };

  const handleOptionClick = (opt: string) => {
      if (opt === '生成效果圖') {
          setAppState('GENERATING_RENDER');
          setMessages(prev => [...prev, {
              id: Date.now().toString(),
              type: 'text',
              content: opt,
              sender: 'user',
              timestamp: Date.now()
          }]);
          triggerImageGeneration(renderData, pendingImage?.blobUrl, undefined);
      } else {
          handleSendMessage(opt);
      }
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
