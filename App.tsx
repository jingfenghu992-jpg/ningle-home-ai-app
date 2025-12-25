import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from './components/AppShell';
import { AppBar } from './components/AppBar';
import { StartScreen } from './components/StartScreen';
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
  
  const [uploads, setUploads] = useState<Record<string, { dataUrl: string; blobUrl?: string; width?: number; height?: number; spaceType?: string }>>({});
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
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

  const addSystemToast = (text: string, options?: string[]) => {
      setMessages(prev => [...prev, { id: Date.now().toString(), type: 'text', content: text, sender: 'ai', timestamp: Date.now(), options }]);
  };

  const resetToStart = () => {
      setAppState('START');
      setUploads({});
      setActiveUploadId(null);
      setAnalysisSummary(null);
      setLastGeneratedImage(null);
      setMessages([]);
  };

  const handleUpload = (file: File) => {
    compressImage(file, 1536, 0.8).then(blob => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            setActiveUploadId(uploadId);

            // Show the latest uploaded image in chat immediately (user bubble)
            setMessages(prev => [
                ...prev,
                { id: `${uploadId}-upload`, type: 'image', content: dataUrl, sender: 'user', timestamp: Date.now(), meta: { kind: 'upload', uploadId } }
            ]);

            // Probe image dimensions (used to pick best StepFun output size)
            try {
                const img = new Image();
                img.onload = () => {
                    setUploads(prev => ({ ...prev, [uploadId]: { dataUrl, blobUrl: '', width: img.width, height: img.height } }));
                    setAppState('WAITING_FOR_SPACE');
                    addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客廳/睡房/廚房/玄關/書房/其他）");
                };
                img.onerror = () => {
                    setUploads(prev => ({ ...prev, [uploadId]: { dataUrl, blobUrl: '' } }));
                    setAppState('WAITING_FOR_SPACE');
                    addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客廳/睡房/廚房/玄關/書房/其他）");
                };
                img.src = dataUrl;
            } catch {
                setUploads(prev => ({ ...prev, [uploadId]: { dataUrl, blobUrl: '' } }));
                setAppState('WAITING_FOR_SPACE');
                addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客廳/睡房/廚房/玄關/書房/其他）");
            }
            
            // Upload in background
            try {
                const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
                const upRes = await uploadImage(compressedFile);
                if (upRes?.url) {
                    setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], blobUrl: upRes.url } }) : prev);
                }
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
            { id: assistantId, type: 'text', content: '', sender: 'ai', timestamp: Date.now(), isStreaming: true }
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
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m));
        } catch (e: any) {
            console.error(e);
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false, content: `（聊天失敗：${e?.message || '未知錯誤'}）` } : m));
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

        // Polite status message before analysis starts
        addSystemToast("收到，圖片正在分析中，請稍等…");
        setAppState('ANALYZING');
        // Perform Analysis
        try {
            const uid = activeUploadId;
            const active = uid ? uploads[uid] : undefined;
            if (!uid || !active?.dataUrl) {
                addSystemToast("搵唔到你最新上傳嗰張相，麻煩你再上傳一次～");
                setAppState('START');
                return;
            }

            setUploads(prev => prev[uid] ? ({ ...prev, [uid]: { ...prev[uid], spaceType: text } }) : prev);
            const visionRes = await analyzeImage({ 
                imageDataUrl: active.dataUrl, 
                imageUrl: active.blobUrl, 
                mode: 'consultant', 
                spaceType: text 
            } as any);

            if (visionRes.ok && visionRes.vision_summary) {
                setAnalysisSummary(visionRes.vision_summary);
                setAppState('ANALYSIS_DONE');
                // Append analysis summary + action buttons into chat flow
                addSystemToast(
                    `【圖片分析結果】\n${visionRes.vision_summary}\n\n想再分析另一張相？直接點左下角圖片按鈕再上傳就得～`,
                    ["生成智能效果圖"]
                );
                // Bind the action to this uploadId by attaching meta to the last message
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (!last) return prev;
                    return [
                        ...prev.slice(0, -1),
                        { ...last, meta: { ...(last.meta || {}), kind: 'analysis', uploadId: uid } }
                    ];
                });
                
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

  const handleRenderIntakeComplete = (data: any) => {
      setAppState('GENERATING');
      triggerGeneration(data);
  };

  const triggerGeneration = async (intakeData: any, revisionText?: string) => {
      try {
          const pickStepFunSize = (w?: number, h?: number) => {
              if (!w || !h) return '1280x800';
              const ratio = w / h;
              // Prefer 16:9 sizes for room photos; use square only if close to square.
              if (ratio > 1.15) return '1280x800';
              if (ratio < 0.87) return '800x1280';
              return '1024x1024';
          };

          const payload = {
              prompt: '', 
              renderIntake: intakeData || {}, 
              baseImageBlobUrl: lastGeneratedImage || (intakeData?.baseImageBlobUrl ?? ''), 
              size: pickStepFunSize(intakeData?.baseWidth, intakeData?.baseHeight),
              // StepFun doc: smaller source_weight => more similar to source (less deformation)
              source_weight: 0.4,
              steps: 40,
              cfg_scale: 6.0
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
              // Also append generated image into chat flow so it follows conversation
              setMessages(prev => [
                  ...prev,
                  { id: `${Date.now()}-img`, type: 'image', content: resultUrl!, sender: 'ai', timestamp: Date.now() }
              ]);
          } else {
              throw new Error(res.message);
          }
      } catch (e: any) {
          addSystemToast(`生成失敗：${e.message}`);
          setAppState('ANALYSIS_DONE'); // Revert state
      }
  };

  const handleOptionClick = (message: Message, opt: string) => {
      if (opt === '生成智能效果圖') {
          const uploadId = message.meta?.uploadId;
          const u = uploadId ? uploads[uploadId] : undefined;
          // If blob URL not ready, guide user to wait to avoid "Missing baseImageBlobUrl"
          if (!uploadId || !u) {
              addSystemToast("搵唔到對應嘅相片，麻煩你再上傳一次～");
              return;
          }
          if (!u.blobUrl) {
              addSystemToast("相片仲上傳緊，請等幾秒再試～");
              return;
          }
          addSystemToast("收到～我而家幫你生成效果圖（會盡量保留原本門窗/梁柱/結構），請稍等…");
          setAppState('GENERATING');
          // Generate directly with a sane default intake to make the button always work
          const defaultIntake = {
              space: u.spaceType || 'room',
              style: 'modern',
              color: 'neutral',
              requirements: 'Preserve the original structure, windows, doors, and perspective. Improve storage and lighting. Hong Kong apartment practical layout.'
              ,
              baseImageBlobUrl: u.blobUrl,
              baseWidth: u.width,
              baseHeight: u.height
          };
          triggerGeneration(defaultIntake);
          return;
      }
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

            {/* 3. Small Chat Stream (Toasts/Short interaction) */}
            <div className="mt-4">
                {messages.map((msg) => (
                    <MessageCard key={msg.id} message={msg} onOptionClick={handleOptionClick} />
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
