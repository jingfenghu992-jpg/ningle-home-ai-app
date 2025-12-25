import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from './components/AppShell';
import { AppBar } from './components/AppBar';
import { StartScreen } from './components/StartScreen';
import { PhotoCard } from './components/PhotoCard';
import { NextStepCard } from './components/NextStepCard';
import { AnalysisCard } from './components/AnalysisCard';
import { RenderIntakeCard } from './components/RenderIntakeCard';
import { RenderResultCard } from './components/RenderResultCard';
import { MessageCard } from './components/MessageCard';
import { Composer } from './components/Composer';
import { Message } from './types';
import { analyzeImage } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateDesignImage, uploadImage } from './services/generateClient';
import { compressImage } from './services/utils';

const App: React.FC = () => {
  // --- State ---
  const [appState, setAppState] = useState<'START' | 'WAITING_FOR_SPACE' | 'ANALYZING' | 'ANALYSIS_DONE' | 'RENDER_INTAKE' | 'GENERATING' | 'RENDER_DONE'>('START');
  
  const [pendingImage, setPendingImage] = useState<{dataUrl: string, blobUrl?: string} | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(null);
  
  // Chat history for context, but we display sparingly
  const [messages, setMessages] = useState<Message[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, appState]);

  // --- Handlers ---

  const handleUpload = (file: File) => {
    compressImage(file, 1536, 0.8).then(blob => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            setPendingImage({ dataUrl, blobUrl: '' });
            setAppState('WAITING_FOR_SPACE');
            
            // Upload in background
            try {
                const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
                const upRes = await uploadImage(compressedFile);
                if (upRes?.url) setPendingImage(prev => prev ? { ...prev, blobUrl: upRes.url } : null);
            } catch (err) { console.error(err); }
        };
        reader.readAsDataURL(blob);
    });
  };

  const handleSendMessage = async (text: string) => {
    // Add user message to history
    const userMsg: Message = { id: Date.now().toString(), type: 'text', content: text, sender: 'user', timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    const runChat = async () => {
        const assistantId = `${Date.now()}-ai`;
        // Create an empty assistant message for streaming updates
        setMessages(prev => [
            ...prev,
            { id: assistantId, type: 'text', content: '', sender: 'ai', timestamp: Date.now() }
        ]);

        try {
            const apiMessages = [...messages, userMsg]
                .filter(m => m.type === 'text' && typeof m.content === 'string')
                .map(m => ({
                    role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: m.content
                }));

            for await (const delta of chatWithDeepseekStream({
                mode: 'consultant',
                text,
                messages: apiMessages,
                visionSummary: analysisSummary || undefined
            })) {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + delta } : m));
            }
        } catch (e: any) {
            console.error(e);
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `（聊天失敗：${e?.message || '未知錯誤'}）` } : m));
        }
    };

    if (appState === 'WAITING_FOR_SPACE') {
        // Only treat the input as "space type" if it actually looks like one.
        // Otherwise, keep waiting for space type and allow normal chat.
        const normalized = text.replace(/\s+/g, '');
        const isSpaceType =
            [
                '客廳','客厅',
                '餐廳','餐厅',
                '睡房','卧室','房間','房间','主人房','主卧','次卧',
                '廚房','厨房',
                '玄關','玄关',
                '書房','书房',
                '浴室','洗手間','洗手间','厕所','衛生間','卫生间',
                '走廊','通道',
                '露台','阳台',
                '其他'
            ].some(k => normalized.includes(k));

        if (!isSpaceType) {
            await runChat();
            return;
        }

        setAppState('ANALYZING');
        // Perform Analysis
        try {
            const visionRes = await analyzeImage({ 
                imageDataUrl: pendingImage!.dataUrl, 
                imageUrl: pendingImage!.blobUrl, 
                mode: 'consultant', 
                spaceType: text 
            } as any);

            if (visionRes.ok && visionRes.vision_summary) {
                setAnalysisSummary(visionRes.vision_summary);
                setAppState('ANALYSIS_DONE');
                
                // Optional: Short toast from AI
                // addSystemToast("分析完成！可以睇下上面嘅摘要。");
            } else {
                addSystemToast("分析失敗，請重試。");
                setAppState('WAITING_FOR_SPACE');
            }
        } catch (e) {
            console.error(e);
            addSystemToast("系統錯誤，請重試。");
            setAppState('WAITING_FOR_SPACE');
        }
    } else if (appState === 'RENDER_DONE' || lastGeneratedImage) {
        // Revision logic
        if (text.includes('改') || text.includes('換') || text.includes('唔好')) {
             setAppState('GENERATING');
             triggerGeneration(null, text); // Pass revision text
        } else {
             // Normal chat (after render)
             await runChat();
        }
    } else {
        // Normal chat (generic)
        await runChat();
    }
  };

  const addSystemToast = (text: string) => {
      setMessages(prev => [...prev, { id: Date.now().toString(), type: 'text', content: text, sender: 'ai', timestamp: Date.now() }]);
  };

  const handleRenderIntakeComplete = (data: any) => {
      setAppState('GENERATING');
      triggerGeneration(data);
  };

  const triggerGeneration = async (intakeData: any, revisionText?: string) => {
      try {
          const payload = {
              prompt: '', 
              renderIntake: intakeData || {}, 
              baseImageBlobUrl: lastGeneratedImage || pendingImage?.blobUrl || undefined, 
              size: '1024x1024'
          };
          
          // If revision, we assume we use the last generated image as base
          if (revisionText) {
              payload.baseImageBlobUrl = lastGeneratedImage || undefined;
              payload.renderIntake = { requirements: `Modification: ${revisionText}` } as any; 
          }

          const res = await generateDesignImage(payload as any);

          if (res.ok && (res.resultBlobUrl || res.b64_json)) {
              const resultUrl = res.resultBlobUrl || (res.b64_json ? `data:image/jpeg;base64,${res.b64_json}` : null);
              setLastGeneratedImage(resultUrl!);
              setAppState('RENDER_DONE');
          } else {
              throw new Error(res.message);
          }
      } catch (e: any) {
          addSystemToast(`生成失敗：${e.message}`);
          setAppState('ANALYSIS_DONE'); // Revert state
      }
  };

  // Determine Photo Status Badge
  const getPhotoStatus = () => {
      if (appState === 'WAITING_FOR_SPACE') return 'waiting';
      if (appState === 'ANALYZING') return 'analyzing';
      if (appState === 'GENERATING') return 'rendering';
      if (appState === 'ANALYSIS_DONE' || appState === 'RENDER_INTAKE' || appState === 'RENDER_DONE') return 'done';
      return 'waiting';
  };

  return (
    <AppShell>
      <AppBar />
      
      {appState === 'START' ? (
        <StartScreen 
            onUpload={handleUpload} 
        />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-none pb-4">
            
            {/* 1. Main Photo Card */}
            {pendingImage && (
                <PhotoCard 
                    imageUrl={lastGeneratedImage || pendingImage.dataUrl} 
                    status={getPhotoStatus()}
                    timestamp={Date.now()}
                />
            )}

            {/* 2. State-based Cards */}
            
            {appState === 'WAITING_FOR_SPACE' && (
                <NextStepCard text="收到～想確認一下：呢張相係邊個空間？（例如：客廳/睡房/廚房/玄關/書房/其他）" />
            )}

            {(appState === 'ANALYSIS_DONE' || appState === 'RENDER_INTAKE' || appState === 'GENERATING' || appState === 'RENDER_DONE') && (
                <AnalysisCard summary={analysisSummary || ''} />
            )}

            {appState === 'ANALYSIS_DONE' && (
                <div className="mx-4 mt-2">
                    <NextStepCard text="想再準啲，可以答兩句：呢度係咩空間？幾多人住？" />
                    <div className="flex gap-2 mt-3">
                        <button 
                            onClick={() => setAppState('RENDER_INTAKE')}
                            className="flex-1 bg-[#8A8F79] text-white py-3 rounded-xl font-bold shadow-md active:scale-95 transition-transform"
                        >
                            生成智能效果圖
                        </button>
                        <button 
                            onClick={() => setAppState('START')}
                            className="flex-1 bg-white text-[#4A453C] border border-[#EBE8E3] py-3 rounded-xl font-medium active:scale-95 transition-transform"
                        >
                            再上傳另一張
                        </button>
                    </div>
                </div>
            )}

            {appState === 'RENDER_INTAKE' && (
                <RenderIntakeCard onComplete={handleRenderIntakeComplete} />
            )}

            {appState === 'GENERATING' && (
                <div className="mx-4 my-6 p-6 bg-white rounded-[24px] flex flex-col items-center justify-center space-y-4 animate-pulse">
                    <div className="w-12 h-12 rounded-full border-4 border-[#8A8F79]/20 border-t-[#8A8F79] animate-spin"></div>
                    <p className="text-[#4A453C] font-medium">正在生成智能效果圖...</p>
                </div>
            )}

            {appState === 'RENDER_DONE' && lastGeneratedImage && (
                <RenderResultCard 
                    imageUrl={lastGeneratedImage} 
                    onModify={() => addSystemToast("請直接輸入你想修改嘅地方（例如：轉做深木色）")}
                    onWhatsApp={() => window.open('https://wa.me/85212345678', '_blank')}
                />
            )}

            {/* 3. Small Chat Stream (Toasts/Short interaction) */}
            <div className="mt-4">
                {messages.slice(-3).map((msg) => ( // Only show last 3 messages to avoid clutter
                    <MessageCard key={msg.id} message={msg} />
                ))}
                <div ref={chatEndRef} />
            </div>

          </div>

          <Composer 
            onSendMessage={handleSendMessage} 
            onSendImage={handleUpload} 
            disabled={appState === 'ANALYZING' || appState === 'GENERATING'} 
          />
        </>
      )}
    </AppShell>
  );
};

export default App;
