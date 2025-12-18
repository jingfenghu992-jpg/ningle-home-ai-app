import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ModeSwitcher from './components/ModeSwitcher';
import InputBar from './components/InputBar';
import MessageBubble from './components/MessageBubble';
import { Message, AppMode } from './types';
import { INITIAL_MESSAGE } from './constants';
import { analyzeImage } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateImage } from './services/generateClient';

const DESIGN_INITIAL_MESSAGE: Message = {
  id: 'init-design',
  type: 'text',
  // 智能設計模式固定開場白（只出現一次）
  content:
    '好呀，我而家幫你整理設計方向。你先揀幾項重點，等我之後出嘅效果圖會更貼近你想要。',
  sender: 'ai',
  timestamp: Date.now(),
};

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('consultant');
  const [chatHistory, setChatHistory] = useState<{ consultant: Message[], design: Message[] }>({
    consultant: [INITIAL_MESSAGE],
    design: [DESIGN_INITIAL_MESSAGE]
  });
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Derived State & Setter Wrapper
  const messages = chatHistory[mode];
  const setMessages = (action: React.SetStateAction<Message[]>) => {
    setChatHistory(prev => {
      const currentList = prev[mode];
      const newList = typeof action === 'function' 
        ? (action as (prev: Message[]) => Message[])(currentList)
        : action;
      return { ...prev, [mode]: newList };
    });
  };
  
  // Consultant mode: pending image state
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string | null>(null);
  const [awaitingSpace, setAwaitingSpace] = useState(false);

  // Design mode state
  const [designStep, setDesignStep] = useState<
    | 'q1_space'
    | 'q2_cabinet'
    | 'q3_focus'
    | 'q4_style'
    | 'q5_color'
    | 'q6_usage'
    | 'q7_door'
    | 'request_image'
    | 'analyze_image'
    | 'generate_design'
    | 'present_result'
    | 'revision_waiting'
    | 'completed'
  >('q1_space');

  const [designData, setDesignData] = useState<{
    space?: string;
    cabinet?: string;
    designFocus?: string;
    style?: string;
    colorTone?: string;
    usageScenario?: string;
    doorType?: string;
  }>({});
  const [designImageDataUrl, setDesignImageDataUrl] = useState<string | null>(null);
  const [designStructureLock, setDesignStructureLock] = useState<string | null>(null);
  const generatingRef = useRef(false);

  // Scroll to bottom whenever messages change
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle mode change
  useEffect(() => {
    if (mode === 'design' && designStep === 'q1_space' && messages.length === 1) {
      setTimeout(() => {
        processDesignFlow();
      }, 100);
    }
  }, [mode, designStep]);

  const handleSendMessage = async (text: string) => {
    // 顧問模式：切換到智能設計模式
    if (mode === 'consultant' && !awaitingSpace) {
      const trimmed = text.trim();
      const designKeywords = ['效果圖', '效果图', '出圖', '出图', '想睇效果', '想睇效果圖', '想出圖', '想出图', '設計圖', '设计图'];
      const hasDesignIntent = designKeywords.some((kw) => trimmed.includes(kw));
      if (hasDesignIntent) {
        const userMessage: Message = {
          id: Date.now().toString(),
          type: 'text',
          content: text,
          sender: 'user',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);

        setDesignStep('q1_space');
        setDesignData({});
        setDesignImageDataUrl(null);
        setMode('design');
        setChatHistory((prev) => ({
          ...prev,
          design: [DESIGN_INITIAL_MESSAGE],
        }));
        return;
      }
    }

    // 設計模式：資料收集階段
    if (
      mode === 'design' &&
      designStep !== 'request_image' &&
      designStep !== 'analyze_image' &&
      designStep !== 'generate_design' &&
      designStep !== 'present_result' &&
      designStep !== 'revision_waiting' &&
      designStep !== 'completed'
    ) {
      processDesignFlow(text);
      return;
    }

    // 設計模式：Revision
    if (mode === 'design' && (designStep === 'revision_waiting' || designStep === 'completed')) {
      if (!designImageDataUrl || !designStructureLock) {
        const errorMsg: Message = {
          id: Date.now().toString(),
          type: 'text',
          content: '我而家未搵到你之前上傳嘅相片，麻煩你重新上傳一次相片，我再幫你出效果圖。',
          sender: 'ai',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        setDesignStep('request_image');
        return;
      }

      const userMessage: Message = {
        id: Date.now().toString(),
        type: 'text',
        content: text,
        sender: 'user',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      console.debug('[App] Triggering revision with delta:', { revisionDelta: text });
      setDesignStep('revision_waiting');

      await triggerDesignImageGeneration(
        designImageDataUrl,
        designStructureLock,
        text,
      );
      return;
    }

    // 顧問模式：圖片已上載並等待空間確認
    if (mode === 'consultant' && awaitingSpace && pendingImageDataUrl) {
      setAwaitingSpace(false);
      
      const userMessage: Message = {
        id: Date.now().toString(),
        type: 'text',
        content: text,
        sender: 'user',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Immediate Feedback
      const aiMessageId = (Date.now() + 1).toString();
      const aiPlaceholder: Message = {
        id: aiMessageId,
        type: 'text',
        content: '收到你張相喇，我而家幫你睇緊…',
        sender: 'ai',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiPlaceholder]);

      // Timers for feedback
      const timer3s = setTimeout(() => {
        setMessages(prev => {
           const updated = [...prev];
           const idx = updated.findIndex(m => m.id === aiMessageId);
           if (idx !== -1 && updated[idx].content.includes('幫你睇緊')) {
               updated[idx] = { ...updated[idx], content: '我分析緊張相嘅結構，請等多陣…' };
           }
           return updated;
        });
      }, 3000);

      const timer8s = setTimeout(() => {
        setMessages(prev => {
           const updated = [...prev];
           const idx = updated.findIndex(m => m.id === aiMessageId);
           if (idx !== -1 && updated[idx].content.includes('分析緊')) {
               updated[idx] = { ...updated[idx], content: '網絡有少少慢，我仲努力緊，好快有結果🙂' };
           }
           return updated;
        });
      }, 8000);

      try {
        const vision = await analyzeImage({ 
          imageDataUrl: pendingImageDataUrl, 
          mode: 'consultant' 
        });
        
        if (!vision.ok || !vision.vision_summary) {
          clearTimeout(timer3s);
          clearTimeout(timer8s);
          setMessages((prev) => {
            const updated = [...prev];
            const index = updated.findIndex((m) => m.id === aiMessageId);
            if (index !== -1) {
              updated[index] = {
                ...updated[index],
                content: vision.message || '我收到你張相片，但而家暫時分析唔到。你可唔可以再發一次清晰啲嘅相片？（或者講咗空間先）',
              };
            }
            return updated;
          });
          setPendingImageDataUrl(null);
          return;
        }

        const chatText = `用戶上傳了${text}的相片，請根據視覺分析給出專業建議。`;
        
        const chatHistory = messages
          .filter(msg => msg.id !== aiMessageId && msg.id !== userMessage.id)
          .map(msg => ({
            role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
            content: msg.type === 'image' 
              ? (msg.visionSummary ? `[用戶上傳了圖片]${msg.visionSummary}` : '[用戶上傳了圖片]')
              : msg.content
          }));
        
        let fullContent = '';
        let isFirstChunk = true;
        for await (const chunk of chatWithDeepseekStream({ 
          mode: 'consultant',
          text: chatText,
          visionSummary: vision.vision_summary,
          messages: chatHistory
        })) {
          if (isFirstChunk) {
              clearTimeout(timer3s);
              clearTimeout(timer8s);
              fullContent = chunk;
              isFirstChunk = false;
          } else {
              fullContent += chunk;
          }

          setMessages((prev) => {
            const updated = [...prev];
            const index = updated.findIndex((m) => m.id === aiMessageId);
            if (index !== -1) {
              updated[index] = {
                ...updated[index],
                content: fullContent,
              };
            }
            return updated;
          });
        }
        setPendingImageDataUrl(null);

      } catch (error) {
        clearTimeout(timer3s);
        clearTimeout(timer8s);
        console.error('[App] Consultant image flow error:', error);
        setMessages((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((m) => m.id === aiMessageId);
          if (index !== -1) {
            updated[index] = {
              ...updated[index],
              content: '我收到你張相片，但而家暫時分析唔到。你可唔可以再發一次清晰啲嘅相片？（或者講咗空間先）',
            };
          }
          return updated;
        });
        setPendingImageDataUrl(null);
      }
      return;
    }

    // Normal text message flow
    const newMessage: Message = {
      id: Date.now().toString(),
      type: 'text',
      content: text,
      sender: 'user',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMessage]);

    // Immediate Feedback
    const aiMessageId = (Date.now() + 1).toString();
    const aiPlaceholder: Message = {
      id: aiMessageId,
      type: 'text',
      content: '收到，我即刻睇緊…',
      sender: 'ai',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, aiPlaceholder]);

    // Timers
    const timer3s = setTimeout(() => {
        setMessages(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(m => m.id === aiMessageId);
            if (idx !== -1 && updated[idx].content === '收到，我即刻睇緊…') {
                updated[idx] = { ...updated[idx], content: '我整理緊重點…' };
            }
            return updated;
        });
    }, 3000);

    const timer8s = setTimeout(() => {
        setMessages(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(m => m.id === aiMessageId);
            if (idx !== -1 && (updated[idx].content === '我整理緊重點…' || updated[idx].content === '收到，我即刻睇緊…')) {
                 updated[idx] = { ...updated[idx], content: '網絡有少少慢，我仲喺度🙂' };
            }
            return updated;
        });
    }, 8000);

    try {
      const chatHistory = messages
        .filter(msg => msg.id !== aiMessageId && msg.id !== newMessage.id)
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
          content: msg.type === 'image' 
            ? (msg.visionSummary ? `[用戶上傳了圖片]${msg.visionSummary}` : '[用戶上傳了圖片]')
            : msg.content
        }));

      let fullContent = '';
      let isFirstChunk = true;
      for await (const chunk of chatWithDeepseekStream({ 
        mode,
        text,
        messages: chatHistory
      })) {
        if (isFirstChunk) {
            clearTimeout(timer3s);
            clearTimeout(timer8s);
            fullContent = chunk;
            isFirstChunk = false;
        } else {
            fullContent += chunk;
        }
        
        setMessages((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((m) => m.id === aiMessageId);
          if (index !== -1) {
            updated[index] = {
              ...updated[index],
              content: fullContent,
            };
          }
          return updated;
        });
      }
    } catch (error: any) {
      clearTimeout(timer3s);
      clearTimeout(timer8s);
      console.error("Chat Error:", error);
      
      let errMsg = '系統繁忙，請稍後再試。';
      if (error.message?.includes('MISSING_KEY')) {
          errMsg = '【系統配置錯誤】伺服器缺少 DEEPSEEK_API_KEY，請通知管理員檢查 Vercel 環境變數。';
      } else if (error.message?.includes('401') || error.message?.includes('429')) {
          errMsg = '【AI 服務提示】DeepSeek 服務繁忙或額度不足 (401/429)，請稍後再試。';
      } else if (error.message) {
          errMsg = `系統錯誤 (Detail)：${error.message}`;
      }

      setMessages((prev) => {
        const updated = [...prev];
        const index = updated.findIndex((m) => m.id === aiMessageId);
        if (index !== -1) {
          updated[index] = {
            ...updated[index],
            content: errMsg,
          };
        }
        return updated;
      });
    }
  };

  const handleSendImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      if (e.target?.result && typeof e.target.result === 'string') {
        const dataUrl = e.target.result;
        const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
        const imageMime = mimeMatch ? mimeMatch[1] : 'unknown';

        const userImageMessage: Message = {
          id: Date.now().toString(),
          type: 'image',
          content: dataUrl,
          sender: 'user',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userImageMessage]);

        if (mode === 'consultant') {
          setPendingImageDataUrl(dataUrl);
          setAwaitingSpace(true);
          
          const spaceOptions = ['客廳', '餐廳', '睡房', '廚房', '浴室', '玄關', '書房', '全屋'];
          const spaceQuestion: Message = {
            id: (Date.now() + 1).toString(),
            type: 'text',
            content: '我收到你張相啦～想確認一下，呢個係邊個空間先？🙂',
            sender: 'ai',
            timestamp: Date.now(),
            options: spaceOptions
          };
          setMessages((prev) => [...prev, spaceQuestion]);
          return;
        }

        if (mode === 'design') {
          if (designStep !== 'request_image') {
            const errorMsg: Message = {
              id: Date.now().toString(),
              type: 'text',
              content: '請先完成上面嘅資料收集，我先可以幫你分析相片 🙏',
              sender: 'ai',
              timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, errorMsg]);
            return;
          }

          setDesignImageDataUrl(dataUrl);
          setDesignStep('analyze_image');

          const aiMessageId = (Date.now() + 1).toString();
          const aiPlaceholder: Message = {
            id: aiMessageId,
            type: 'text',
            content: '收到相片啦，我分析緊～請稍等一陣 😊',
            sender: 'ai',
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, aiPlaceholder]);

          try {
            const vision = await analyzeImage({ imageDataUrl: dataUrl, mode: 'design' });

            if (!vision.ok || !vision.vision_summary) {
              let errorContent = '我好似未成功讀到張相，你可唔可以再上傳一次（JPG/PNG）？';
              
              if (vision.errorCode === 'MISSING_KEY') {
                  errorContent = '【系統提示】伺服器未配置 STEPFUN_VISION_API_KEY，無法分析圖片。請通知管理員檢查 Vercel 環境變數。';
              } else if (vision.errorCode === 'INVALID_PAYLOAD') {
                  errorContent = '圖片格式有問題，請試下重新上載 JPG 或 PNG。';
              } else if (vision.message?.includes('401') || vision.message?.includes('429')) {
                   errorContent = '【系統提示】AI 視覺服務目前繁忙或配額已滿 (401/429)，請稍後再試。';
              }

              setMessages(prev => {
                const updated = [...prev];
                const index = updated.findIndex((m) => m.id === aiMessageId);
                if (index !== -1) {
                  updated[index] = {
                    ...updated[index],
                    content: errorContent,
                  };
                }
                return updated;
              });
              setDesignStep('request_image');
              return;
            }

            setMessages((prev) => {
              const updated = [...prev];
              const index = updated.findIndex((m) => m.id === userImageMessage.id);
              if (index !== -1) {
                updated[index] = {
                  ...updated[index],
                  visionSummary: vision.vision_summary
                };
              }
              return updated;
            });

            const structLock = normalizeDesignStructureLock(vision.extraction || {}, vision.vision_summary || '');
            setDesignStructureLock((prev) => prev || structLock);

            await triggerDesignImageGeneration(
              dataUrl,
              structLock,
              undefined,
            );
            return;
          } catch (error) {
            console.error('[App] Design image vision error:', error);
            setMessages((prev) => {
              const updated = [...prev];
              const index = updated.findIndex((m) => m.id === aiMessageId);
              if (index !== -1) {
                updated[index] = {
                  ...updated[index],
                  content: '我好似未成功讀到張相，你可唔可以再上傳一次（JPG/PNG）？',
                };
              }
              return updated;
            });
            setDesignStep('request_image');
            return;
          }
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // ... (keeping other helper functions like parseDesignImageInstruction, normalizeDesignStructureLock, etc.)
  // Note: I will just include the rest of the file content as is, assuming I didn't break the closure.
  // Actually, to be safe, I should use the previous read content and only replace the relevant functions or write the whole file carefully.
  // The logic for helpers is at the bottom of the previous file. I'll re-include them.

  function parseDesignImageInstruction(text: string): { finalPrompt: string | null; safeUserText: string } {
    const full = text || '';
    let finalPrompt: string | null = null;
    const finalIdx = full.indexOf('FINAL_IMAGE_PROMPT:');
    if (finalIdx !== -1) {
      const selfIdx = full.indexOf('PROMPT_SELF_CHECK:', finalIdx);
      const endIdx = selfIdx !== -1 ? selfIdx : full.length;
      const finalBlock = full.slice(finalIdx, endIdx);
      let m = finalBlock.match(/\[PROMPT:\s*([\s\S]*?)\]/i);
      if (!m) m = finalBlock.match(/PROMPT:\s*([^\n]+)/i);
      if (m && m[1]) finalPrompt = m[1].trim();
    }
    if (!finalPrompt && full.includes('<<<GENERATE_IMAGE>>>')) {
      let m = full.match(/\[PROMPT:\s*([\s\S]*?)\]/i);
      if (!m) m = full.match(/PROMPT:\s*([^\n]+)/i);
      if (m && m[1]) finalPrompt = m[1].trim();
    }
    let safe = full;
    safe = safe.replace(/FINAL_IMAGE_PROMPT:[\s\S]*?(PROMPT_SELF_CHECK:|$)/i, '$1');
    safe = safe.replace(/PROMPT_SELF_CHECK:[\s\S]*$/i, '');
    safe = safe.replace(/\[PROMPT:[\s\S]*?]/i, '');
    safe = safe.replace(/PROMPT:\s*[^\n]+/i, '');
    safe = safe.replace(/<<<GENERATE_IMAGE>>>/g, '');
    safe = safe.trim();
    return { finalPrompt, safeUserText: safe };
  }

  function normalizeDesignStructureLock(extraction: any, visionSummary?: string): string {
    const roomType = extraction?.roomTypeGuess || '未明確空間類型';
    const cameraShot = extraction?.camera?.shotType || '視角未明確（大致為一般室內構圖）';
    const cameraHeight = extraction?.camera?.viewpointHeight || '鏡頭高度大約在中等視線水平';
    const lensFeel = extraction?.camera?.lensFeel || '鏡頭感覺接近正常視角';
    const horizonLine = extraction?.composition?.horizonLine || '地平線大約在畫面中段';
    const vanishingPoint = extraction?.composition?.vanishingPoint || '主要消失點大約在畫面中央附近';
    const mainSubjectZone = extraction?.composition?.mainSubjectZone || '主要牆位或櫃位大致在畫面中央區域';
    const windowsDoorsArr: any[] = extraction?.openings?.windowsDoors && Array.isArray(extraction.openings.windowsDoors) ? extraction.openings.windowsDoors : [];
    const windowsDoorsDesc = windowsDoorsArr.length > 0 ? windowsDoorsArr.map((o) => {
      const type = o?.type || '開口';
      const pos = o?.position || '位置不明（約在畫面一側）';
      const notes = o?.notes || '';
      return `${type}（位置：${pos}${notes ? `，特徵：${notes}` : ''}）`;
    }).join('；') : '畫面內未見明顯窗或門，或位置不易判斷';
    const beamsColumns = extraction?.fixedElements?.beamsColumns || '未見明顯樑柱或不易判斷';
    const acBulks = extraction?.fixedElements?.acBulks || '未見明顯冷氣機箱或喉位';
    const balcony = extraction?.fixedElements?.balcony || '未見明顯陽台或露台門';
    const radiatorOrPipe = extraction?.fixedElements?.radiatorOrPipe || '未見明顯暖氣片或外露喉管';
    const floor = extraction?.surfaces?.floor || '地面材質大致為常見室內地面（具體材質與顏色以原圖為準）';
    const walls = extraction?.surfaces?.walls || '牆身大致為淺色系（具體以原圖為準）';
    const ceiling = extraction?.surfaces?.ceiling || '天花大致為平頂或常見室內天花形式';
    const daylightDirection = extraction?.lighting?.daylightDirection || '光線大致平均或方向不易判斷';
    const colorTempFeel = extraction?.lighting?.colorTempFeel || '整體色溫接近中性';
    const shadowFeel = extraction?.lighting?.shadowFeel || '陰影邊緣介乎柔和與一般';
    const summary = visionSummary ? visionSummary.trim() : `空間類型大致為：${roomType}，視覺上可見主要牆身、開口與基本光線情況（具體以相片為準）。`;
    const lines: string[] = [];
    lines.push('【STRUCTURE_LOCK｜結構鎖定摘要】');
    lines.push(`空間推斷：${roomType}`);
    lines.push('');
    lines.push('【相片整體結構摘要】');
    lines.push(summary);
    lines.push('');
    lines.push('【鏡頭與構圖鎖】');
    lines.push(`- 拍攝視角：${cameraShot}`);
    lines.push(`- 鏡頭高度：${cameraHeight}`);
    lines.push(`- 鏡頭感覺：${lensFeel}`);
    lines.push(`- 地平線位置：${horizonLine}`);
    lines.push(`- 消失點方向：${vanishingPoint}`);
    lines.push(`- 主要主體區域：${mainSubjectZone}`);
    lines.push('');
    lines.push('【門窗與開口鎖】');
    lines.push(`- 門窗/開口列表：${windowsDoorsDesc}`);
    lines.push('');
    lines.push('【固定元素鎖】');
    lines.push(`- 樑柱情況：${beamsColumns}`);
    lines.push(`- 冷氣機/喉位：${acBulks}`);
    lines.push(`- 陽台/露台門：${balcony}`);
    lines.push(`- 暖氣片/喉管：${radiatorOrPipe}`);
    lines.push('');
    lines.push('【表面材質與色感鎖】');
    lines.push(`- 地面：${floor}`);
    lines.push(`- 牆身：${walls}`);
    lines.push(`- 天花：${ceiling}`);
    lines.push('');
    lines.push('【光線與陰影鎖】');
    lines.push(`- 自然光大致方向：${daylightDirection}`);
    lines.push(`- 整體色溫感覺：${colorTempFeel}`);
    lines.push(`- 陰影感覺：${shadowFeel}`);
    lines.push('');
    lines.push('【禁止改動（doNotChange）】');
    lines.push('- 不改鏡頭角度、站位和構圖。');
    lines.push('- 不改門窗、玻璃趟門及窗框分格位置與比例。');
    lines.push('- 不改房間形狀比例，不可變成另一個戶型或完全不同空間。');
    lines.push('- 不新增或移除主要開口（包括門、窗、陽台門等）。');
    lines.push('- 不新增人物、文字、LOGO 或水印。');
    lines.push('- 只可改造櫃體、材質配色、收納細節及燈光層次，光向必須跟原圖保持一致或非常接近。');
    return lines.join('\n');
  }

  function validateImagePrompt(promptText: string, fullText: string): boolean {
    if (!promptText || promptText.trim().length < 60) return false;
    const lower = (promptText + '\n' + fullText).toLowerCase();
    const hasCamera = lower.includes('same camera angle') || lower.includes('same viewpoint') || lower.includes('same view');
    const hasWindow = lower.includes('same window positions') || lower.includes('same window') || lower.includes('keep all windows') || lower.includes('keep all window');
    const hasDoNotChange = lower.includes('do not change');
    const hasNoPeople = lower.includes('no people');
    const hasNoText = lower.includes('no text');
    const hasNoWatermark = lower.includes('no watermark');
    const hasProportion = lower.includes('room proportions') || lower.includes('same proportions') || lower.includes('room shape') || lower.includes('do not change the room');
    const hasLight = lower.includes('same lighting direction') || (lower.includes('lighting') && lower.includes('shadow'));
    if (!hasCamera || !hasWindow || !hasDoNotChange || !hasNoPeople || !hasNoText || !hasNoWatermark) return false;
    if (!hasProportion || !hasLight) return false;
    return true;
  }

  function buildFallbackPrompt(structureLockText: string, data: typeof designData): string {
    const space = data.space || 'room';
    const cabinet = data.cabinet || 'built-in cabinet';
    const focus = data.designFocus || 'balanced between storage and aesthetics';
    const style = data.style || 'simple practical style';
    const color = data.colorTone || 'light neutral colours';
    const usage = data.usageScenario || 'two people';
    const door = data.doorType || 'flat cabinet doors';
    const hasStructureLock = structureLockText && structureLockText.length > 50;
    return [
      `realistic interior design render of the existing ${space} in a Hong Kong apartment,`,
      'keep the same camera angle, same viewpoint and same overall composition as the original reference photo,',
      'keep all existing windows and doors in exactly the same positions, do not move, add or remove any openings,',
      'do not change the room shape or proportions, keep all structural walls, beams and columns unchanged,',
      'keep the same lighting direction and a similar shadow direction as in the original photo,',
      hasStructureLock ? `respect the following structural constraints: ${structureLockText.substring(0, 200)}...,` : '',
      `apply a ${style} style with ${color},`,
      `design a ${cabinet} that follows the recommended wall position, optimised for ${focus}, suitable for ${usage},`,
      `use practical materials and ${door}, with neat joinery and well-organised storage,`,
      'no people, no text, no logos, no watermark.'
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  const triggerDesignImageGeneration = async (imageDataUrl: string, structureLockText: string, revisionDelta?: string) => {
    setDesignStep('generate_design');
    const aiMessageId = Date.now().toString();
    const generatingMsg: Message = {
      id: aiMessageId,
      type: 'text',
      content: '我而家幫你整合資料同現場相，準備出一張貼近你空間嘅效果圖，請稍等一陣～',
      sender: 'ai',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, generatingMsg]);

    try {
      const space = designData.space || '未知空間';
      const cabinet = designData.cabinet || '主要訂造櫃體';
      const focus = designData.designFocus || '平衡實用與美觀';
      const style = designData.style || '簡約實用';
      const color = designData.colorTone || '淺色為主';
      const usage = designData.usageScenario || '二人';
      const door = designData.doorType || '平板門';
      const revisionText = (revisionDelta && revisionDelta.trim().length > 0) ? `【客戶追加/微調要求（revision_delta）】\n${revisionDelta.trim()}\n\n` : '';
      const designSummary = `【用戶設計需求資料】
空間類型：${space}
櫃體類型：${cabinet}
設計取向：${focus}
風格方向：${style}
色調方向：${color}
家庭情況：${usage}
門板 / 外觀感覺：${door}
視覺結構摘要（STRUCTURE_LOCK）：${structureLockText}

${revisionText}（如上有 revision_delta，代表客戶只希望在同一個結構鎖基礎上，微調燈光 / 色調 / 門板 / 櫃體細節，絕對唔可以改變鏡頭、構圖、窗門位置、牆身比例同採光方向。）

請你先根據上面嘅視覺結構摘要，內部整理出一組 STRUCTURE_LOCK（包括鏡頭角度、構圖、窗門位置、樑柱 / 冷氣 / 牆身、地面 / 牆身 / 天花、採光方向、可落櫃位置與避免位置，以及不得改動的規則），
再結合用戶已選的設計資料，生成以下兩個區塊：

1) FINAL_IMAGE_PROMPT:
   - 按照 system prompt 裏面規定嘅 [目標] / [結構鎖定（最高優先）] / [可施工設計] / [禁止項] 結構去寫，最後輸出一行英文 [PROMPT: ...] 並加上 <<<GENERATE_IMAGE>>>。

2) PROMPT_SELF_CHECK:
   - 用中文自我檢查你啱啱寫嘅英文 PROMPT 有無清楚講明 same camera angle / same viewpoint、same window positions、do not change、room proportions / room shape、lighting / shadow、no people / no text / no watermark 等關鍵字。
   - 呢部份只作內部自檢，前端會剔除唔俾客人睇，唔好講模型 / 系統 / prompt 等技術字。
`;
      const chatHistory = messages
        .filter((msg) => msg.id !== aiMessageId)
        .map((msg) => ({
          role: msg.sender === 'user' ? ('user' as const) : ('assistant' as const),
          content: msg.type === 'image' ? msg.visionSummary ? `[用戶上傳了圖片]${msg.visionSummary}` : '[用戶上傳了圖片]' : msg.content,
        }));

      let fullContent = '';
      for await (const chunk of chatWithDeepseekStream({
        mode: 'design',
        text: designSummary,
        messages: chatHistory,
      })) {
        fullContent += chunk;
        if (fullContent.includes('<<<GENERATE_IMAGE>>>') && !generatingRef.current) {
          generatingRef.current = true;
          const { finalPrompt, safeUserText } = parseDesignImageInstruction(fullContent);
          let promptText = finalPrompt || '';
          if (!promptText || !validateImagePrompt(promptText, fullContent)) {
            console.warn('[App] DeepSeek prompt did not pass structure-lock validation, using fallback prompt.');
            promptText = buildFallbackPrompt(structureLockText, designData);
          }
          const displayText = safeUserText && safeUserText.trim().length > 0 ? `${safeUserText}\n\n（我會跟住呢個方向幫你出一張貼近現場結構嘅效果圖，請稍等～）` : '我根據你啱啱嘅選擇同張相，幫你整合咗一個設計方向，依家出緊效果圖，請稍等～';
          setMessages((prev) => {
            const updated = [...prev];
            const index = updated.findIndex((m) => m.id === aiMessageId);
            if (index !== -1) updated[index] = { ...updated[index], content: displayText };
            return updated;
          });
          setDesignStep('generate_design');
          let attempt = 0;
          let success = false;
          while (attempt < 2 && !success) {
            try {
              const generateResult = await generateImage({
                prompt: promptText,
                size: '1024x1024',
                response_format: 'b64_json',
              });
              if (generateResult.ok && generateResult.b64_json) {
                success = true;
                setDesignStep('present_result');
                const imgMsg: Message = {
                  id: (Date.now() + 1).toString(),
                  type: 'image',
                  content: generateResult.b64_json,
                  sender: 'ai',
                  timestamp: Date.now(),
                };
                setMessages((prev) => [...prev, imgMsg]);
                const explanationMsg: Message = {
                  id: (Date.now() + 2).toString(),
                  type: 'text',
                  content: `呢個係根據你啱啱揀嘅方向，加上你張相嘅實際結構，幫你出嘅參考效果圖 👇\n\n1）櫃體會沿住${cabinet} 所在牆位去做，盡量唔阻窗門同行走動線。\n2）整體以${style}路線配合${color}，保持空間感，同時有足夠收納。\n3）門板會用${door} 呢類做法，兼顧易打理同耐用度。\n4）收納分區會按「${focus}」去安排，上下層分明，常用同儲物位清楚分開。\n5）如果你仲想微調，例如加燈帶、改門款或者加強某啲位置收納，都可以再同我講，我可以幫你再修一修方向。`,
                  sender: 'ai',
                  timestamp: Date.now(),
                };
                setMessages((prev) => [...prev, explanationMsg]);
                setTimeout(() => {
                  const whatsappMsg: Message = {
                    id: (Date.now() + 3).toString(),
                    type: 'text',
                    content: '如果你想再深入傾下做法，或者想我哋一對一跟進，可以點右上角 WhatsApp，慢慢同你諗清楚整體方案。',
                    sender: 'ai',
                    timestamp: Date.now(),
                  };
                  setMessages((prev) => [...prev, whatsappMsg]);
                  setDesignStep('completed');
                }, 1000);
              } else {
                throw new Error(generateResult.message || '生成失敗');
              }
            } catch (error: any) {
              console.error('[App] Generate image error:', error);
              attempt += 1;
              let errorMessage = '我出圖嗰邊好似有少少延遲，我幫你再試一次出圖，請再等一陣～';
              if (error.message?.includes('MISSING_KEY')) {
                  errorMessage = '【系統提示】伺服器未配置 STEPFUN_IMAGE_API_KEY，無法生成圖片。請通知管理員。';
                  attempt = 2; 
              } else if (error.message?.includes('401') || error.message?.includes('429')) {
                  errorMessage = '【系統提示】AI 出圖服務繁忙或配額不足 (401/429)，無法生成。';
                  attempt = 2; 
              }
              if (attempt < 2) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const index = updated.findIndex((m) => m.id === aiMessageId);
                  if (index !== -1) updated[index] = { ...updated[index], content: errorMessage };
                  return updated;
                });
              } else {
                const finalErrorMsg = (error.message?.includes('MISSING_KEY') || error.message?.includes('401') || error.message?.includes('429')) ? errorMessage : '今次出圖好似有啲問題，你可以再試一次上傳相片（JPG/PNG），或者點右上角 WhatsApp，發張相同講下你嘅要求，我哋設計師可以一對一幫你再睇清楚。';
                setMessages((prev) => {
                  const updated = [...prev];
                  const index = updated.findIndex((m) => m.id === aiMessageId);
                  if (index !== -1) updated[index] = { ...updated[index], content: finalErrorMsg };
                  return updated;
                });
                setDesignStep('request_image');
              }
            }
          }
          generatingRef.current = false;
          return;
        }
      }
      if (!generatingRef.current) {
        generatingRef.current = true;
        const promptText = buildFallbackPrompt(structureLockText, designData);
        setMessages((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((m) => m.id === aiMessageId);
          if (index !== -1) updated[index] = { ...updated[index], content: '我根據你啱啱嘅選擇同張相，幫你整合咗一個設計方向，依家出緊效果圖，請稍等～' };
          return updated;
        });
        setDesignStep('generate_design');
        let attempt = 0;
        let success = false;
        while (attempt < 2 && !success) {
          try {
            const generateResult = await generateImage({
              prompt: promptText,
              size: '1024x1024',
              response_format: 'b64_json',
            });
            if (generateResult.ok && generateResult.b64_json) {
              success = true;
              setDesignStep('present_result');
              const imgMsg: Message = {
                id: (Date.now() + 1).toString(),
                type: 'image',
                content: generateResult.b64_json,
                sender: 'ai',
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, imgMsg]);
              const explanationMsg: Message = {
                id: (Date.now() + 2).toString(),
                type: 'text',
                content: `呢個係根據你啱啱揀嘅方向，加上你張相嘅實際結構，幫你出嘅參考效果圖 👇\n\n1）櫃體會沿住${cabinet} 所在牆位去做，盡量唔阻窗門同行走動線。\n2）整體以${style}路線配合${color}，保持空間感，同時有足夠收納。\n3）門板會用${door} 呢類做法，兼顧易打理同耐用度。\n4）收納分區會按「${focus}」去安排，上下層分明，常用同儲物位清楚分開。\n5）如果你仲想微調，例如加燈帶、改門款或者加強某啲位置收納，都可以再同我講，我可以幫你再修一修方向。`,
                sender: 'ai',
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, explanationMsg]);
              setTimeout(() => {
                const whatsappMsg: Message = {
                  id: (Date.now() + 3).toString(),
                  type: 'text',
                  content: '如果你想再深入傾下做法，或者想我哋一對一跟進，可以點右上角 WhatsApp，慢慢同你諗清楚整體方案。',
                  sender: 'ai',
                  timestamp: Date.now(),
                };
                setMessages((prev) => [...prev, whatsappMsg]);
                setDesignStep('completed');
              }, 1000);
            } else {
              throw new Error(generateResult.message || '生成失敗');
            }
          } catch (error) {
            attempt += 1;
            if (attempt < 2) {
              setMessages((prev) => {
                const updated = [...prev];
                const index = updated.findIndex((m) => m.id === aiMessageId);
                if (index !== -1) updated[index] = { ...updated[index], content: '我出圖嗰邊好似有少少延遲，我幫你再試一次出圖，請再等一陣～' };
                return updated;
              });
            } else {
              setMessages((prev) => {
                const updated = [...prev];
                const index = updated.findIndex((m) => m.id === aiMessageId);
                if (index !== -1) updated[index] = { ...updated[index], content: '今次出圖好似有啲問題，你可以再試一次上傳相片（JPG/PNG），或者點右上角 WhatsApp，發張相同講下你嘅要求，我哋設計師可以一對一幫你再睇清楚。' };
                return updated;
              });
              setDesignStep('request_image');
            }
          }
        }
        generatingRef.current = false;
      }
    } catch (error) {
      console.error('[App] Design image generation error:', error);
      setMessages(prev => {
        const updated = [...prev];
        const index = updated.findIndex((m) => m.id === aiMessageId);
        if (index !== -1) updated[index] = { ...updated[index], content: '我而家出圖好似卡咗一下，你可以再試一次上傳相片（JPG/PNG），或者點右上角 WhatsApp 慢慢傾。' };
        return updated;
      });
      setDesignStep('request_image');
      generatingRef.current = false;
    }
  };

  const DESIGN_STEPS = {
    q1_space: {
      question: '空間類型（單選）\n你今次主要想設計邊個空間？',
      options: ['客廳', '客飯廳', '睡房', '主人房', '書房', '廚房', '玄關', '多功能房'],
    },
    q2_cabinet: {
      question: (space: string) => `第 2 題｜主要訂造櫃體\n喺【${space}】入面，你最想先處理邊一類櫃？`,
    },
    q3_focus: {
      question: '第 3 題｜設計取向\n今次你會比較著重邊一樣？',
      options: ['收納為主', '平衡實用與美觀', '美觀為主'],
    },
    q4_style: {
      question: '第 4 題｜風格方向\n大概想偏向邊類風格？',
      options: ['現代簡約', '日系', '輕奢', '北歐', '實用型'],
    },
    q5_color: {
      question: '第 5 題｜色調方向\n整體色調你會傾向邊一種？',
      options: ['淺色系', '深色系', '木紋為主', '黑白灰', '奶油風'],
    },
    q6_usage: {
      question: '家庭情況（單選）\n主要係邊一種情況？',
      options: ['單身', '二人', '兩大一小', '兩大兩小', '與長者同住'],
    },
    q7_door: {
      question: '門板 / 外觀感覺（單選）\n你比較鍾意邊一種門板 / 外觀？',
      options: ['平板門', '線條門', '玻璃門', '開放格'],
    },
    request_image: {
      question: '好，我已經整理好你嘅設計方向。麻煩你而家上載一張呢個空間嘅現場相片，我會按實際結構幫你出一張參考效果圖。',
    },
  } as const;

  const getCabinetOptionsForSpace = (space: string): string[] => {
    if (space === '客廳' || space === '客飯廳') return ['電視櫃', '展示櫃', '裝飾櫃', '收納櫃', '餐邊櫃', '酒櫃'];
    if (space === '睡房' || space === '主人房') return ['衣櫃', '榻榻米', '地台床', '床頭收納'];
    if (space === '書房' || space === '多功能房') return ['書櫃', '書櫃＋書枱一體', '展示＋收納櫃'];
    if (space === '廚房') return ['地櫃＋吊櫃', '高櫃電器位', '轉角收納拉籃'];
    if (space === '玄關') return ['鞋櫃', '換鞋凳＋鞋櫃', '雜物收納櫃'];
    return ['收納櫃', '展示櫃'];
  };

  const processDesignFlow = (answer?: string) => {
    if (designStep === 'q1_space') {
      if (!answer) {
        const step = DESIGN_STEPS.q1_space;
        const msg: Message = { id: Date.now().toString(), type: 'text', content: step.question, sender: 'ai', timestamp: Date.now(), options: [...step.options], };
        setMessages((prev) => [...prev, msg]);
        return;
      }
      setDesignData((prev) => ({ ...prev, space: answer }));
      const ack: Message = { id: Date.now().toString(), type: 'text', content: '好，收到你想處理嘅空間。', sender: 'ai', timestamp: Date.now(), };
      setMessages((prev) => [...prev, ack]);
      const options = getCabinetOptionsForSpace(answer);
      const q2 = DESIGN_STEPS.q2_cabinet;
      const msg: Message = { id: (Date.now() + 1).toString(), type: 'text', content: typeof q2.question === 'function' ? q2.question(answer) : q2.question, sender: 'ai', timestamp: Date.now(), options: [...options], };
      setDesignStep('q2_cabinet');
      setMessages((prev) => [...prev, msg]);
      return;
    }
    if (designStep === 'q2_cabinet') {
      if (!answer) return;
      setDesignData((prev) => ({ ...prev, cabinet: answer }));
      const ack: Message = { id: Date.now().toString(), type: 'text', content: 'OK，我記低咗主要櫃體類型。', sender: 'ai', timestamp: Date.now(), };
      setMessages((prev) => [...prev, ack]);
      const step = DESIGN_STEPS.q3_focus;
      const msg: Message = { id: (Date.now() + 1).toString(), type: 'text', content: step.question, sender: 'ai', timestamp: Date.now(), options: [...step.options], };
      setDesignStep('q3_focus');
      setMessages((prev) => [...prev, msg]);
      return;
    }
    if (designStep === 'q3_focus') {
      if (!answer) return;
      setDesignData((prev) => ({ ...prev, designFocus: answer }));
      const ack: Message = { id: Date.now().toString(), type: 'text', content: '明白，你比較著重呢個方向。', sender: 'ai', timestamp: Date.now(), };
      setMessages((prev) => [...prev, ack]);
      const step = DESIGN_STEPS.q4_style;
      const msg: Message = { id: (Date.now() + 1).toString(), type: 'text', content: step.question, sender: 'ai', timestamp: Date.now(), options: [...step.options], };
      setDesignStep('q4_style');
      setMessages((prev) => [...prev, msg]);
      return;
    }
    if (designStep === 'q4_style') {
      if (!answer) return;
      setDesignData((prev) => ({ ...prev, style: answer }));
      const ack: Message = { id: Date.now().toString(), type: 'text', content: '好，風格方向我大概捉到啦。', sender: 'ai', timestamp: Date.now(), };
      setMessages((prev) => [...prev, ack]);
      const step = DESIGN_STEPS.q5_color;
      const msg: Message = { id: (Date.now() + 1).toString(), type: 'text', content: step.question, sender: 'ai', timestamp: Date.now(), options: [...step.options], };
      setDesignStep('q5_color');
      setMessages((prev) => [...prev, msg]);
      return;
    }
    if (designStep === 'q5_color') {
      if (!answer) return;
      setDesignData((prev) => ({ ...prev, colorTone: answer }));
      const ack: Message = { id: Date.now().toString(), type: 'text', content: 'OK，色調傾向我記低咗。', sender: 'ai', timestamp: Date.now(), };
      setMessages((prev) => [...prev, ack]);
      const step = DESIGN_STEPS.q6_usage;
      const msg: Message = { id: (Date.now() + 1).toString(), type: 'text', content: step.question, sender: 'ai', timestamp: Date.now(), options: [...step.options], };
      setDesignStep('q6_usage');
      setMessages((prev) => [...prev, msg]);
      return;
    }
    if (designStep === 'q6_usage') {
      if (!answer) return;
      setDesignData((prev) => ({ ...prev, usageScenario: answer }));
      const ack: Message = { id: Date.now().toString(), type: 'text', content: '明白，家庭情況我都記低咗。', sender: 'ai', timestamp: Date.now(), };
      setMessages((prev) => [...prev, ack]);
      const step = DESIGN_STEPS.q7_door;
      const msg: Message = { id: (Date.now() + 1).toString(), type: 'text', content: step.question, sender: 'ai', timestamp: Date.now(), options: [...step.options], };
      setDesignStep('q7_door');
      setMessages((prev) => [...prev, msg]);
      return;
    }
    if (designStep === 'q7_door') {
      if (!answer) return;
      setDesignData((prev) => ({ ...prev, doorType: answer }));
      const msg: Message = { id: Date.now().toString(), type: 'text', content: DESIGN_STEPS.request_image.question, sender: 'ai', timestamp: Date.now(), };
      setDesignStep('request_image');
      setMessages((prev) => [...prev, msg]);
      return;
    }
  };

  const handleOptionClick = (option: string) => {
    if (mode === 'design' && designStep !== 'request_image' && designStep !== 'analyze_image' && designStep !== 'generate_design' && designStep !== 'present_result' && designStep !== 'completed') {
      processDesignFlow(option);
      return;
    }
    handleSendMessage(option);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--wa-bg)] overflow-hidden">
      <Header />
      <ModeSwitcher
        currentMode={mode}
        onModeChange={(newMode) => {
          if (newMode === 'design' && designStep !== 'q1_space') {
            setDesignStep('q1_space');
            setDesignData({});
            setDesignImageDataUrl(null);
            setChatHistory((prev) => ({ ...prev, design: [DESIGN_INITIAL_MESSAGE] }));
          }
          setMode(newMode);
        }}
      />
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
