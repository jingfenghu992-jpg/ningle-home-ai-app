import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from './components/AppShell';
import { AppBar } from './components/AppBar';
import { StartScreen } from './components/StartScreen';
import { MessageCard } from './components/MessageCard';
import { Composer } from './components/Composer';
import { Message } from './types';
import { analyzeImage } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateDesignImage } from './services/generateClient';
import { compressImage } from './services/utils';
import { classifySpace } from './services/spaceClient';

const App: React.FC = () => {
  // --- State ---
  const [appState, setAppState] = useState<'START' | 'WAITING_FOR_SPACE' | 'ANALYZING' | 'ANALYSIS_DONE' | 'RENDER_INTAKE' | 'GENERATING' | 'RENDER_DONE'>('START');
  const [clientId, setClientId] = useState<string>(''); // per-device user id
  
  const [uploads, setUploads] = useState<Record<string, {
    dataUrl: string;
    width?: number;
    height?: number;
    spaceType?: string;
    visionSummary?: string;
    analysisStatus?: 'idle' | 'running' | 'done';
    render?: { style?: string; color?: string; focus?: string; storage?: string; priority?: string; intensity?: string };
  }>>({});
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(null);
  
  // Chat history for context, but we display sparingly
  const [messages, setMessages] = useState<Message[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Ensure a stable clientId for session isolation (per device/browser)
  useEffect(() => {
    try {
      const key = 'ningle_client_id';
      const existing = window.localStorage.getItem(key);
      if (existing) {
        setClientId(existing);
        return;
      }
      const id =
        // @ts-ignore
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          // @ts-ignore
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem(key, id);
      setClientId(id);
    } catch {
      setClientId(`${Date.now()}-${Math.random().toString(16).slice(2)}`);
    }
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, appState]);

  // --- Handlers ---

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const addSystemToast = (text: string, options?: string[]) => {
      setMessages(prev => [...prev, { id: Date.now().toString(), type: 'text', content: text, sender: 'ai', timestamp: Date.now(), options }]);
  };

  const addLoadingToast = (text: string, meta: Message['meta']) => {
      const id = `${Date.now()}-ai-loading`;
      setMessages(prev => [
          ...prev,
          { id, type: 'text', content: text, sender: 'ai', timestamp: Date.now(), meta: { ...(meta || {}), loading: true } }
      ]);
      return id;
  };

  const stopLoadingToast = (id: string) => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, meta: { ...(m.meta || {}), loading: false } } : m));
  };

  const typeOutAI = async (text: string, opts?: { options?: string[]; meta?: Message['meta'] }) => {
      const id = `${Date.now()}-ai-typed`;
      const meta = opts?.meta;
      setMessages(prev => [...prev, { id, type: 'text', content: '', sender: 'ai', timestamp: Date.now(), isStreaming: true, meta }]);

      const chunkSize = 4; // tradeoff: "字字出现" 观感 vs setState 频率
      for (let i = 0; i < text.length; i += chunkSize) {
          const chunk = text.slice(i, i + chunkSize);
          setMessages(prev => prev.map(m => m.id === id ? { ...m, content: m.content + chunk } : m));
          // slightly faster for long summaries
          // (keeps the "typing" feel without being painfully slow)
          // eslint-disable-next-line no-await-in-loop
          await sleep(16);
      }

      setMessages(prev => prev.map(m => m.id === id ? { ...m, isStreaming: false, options: opts?.options } : m));
      return id;
  };

  const resetToStart = () => {
      setAppState('START');
      setUploads({});
      setActiveUploadId(null);
      setAnalysisSummary(null);
      setLastGeneratedImage(null);
      setMessages([]);
  };

  const runAnalysisForUpload = async (uploadId: string, spaceTypeText: string) => {
    const active = uploads[uploadId];
    if (!active?.dataUrl) {
      await typeOutAI("搵唔到對應嘅相片，麻煩你再上傳一次～");
      setAppState('START');
      return;
    }
    // Prevent duplicate analysis for the same uploadId
    if (active.analysisStatus === 'running') {
      await typeOutAI("收到～我而家分析緊呢張相，你等我幾秒先～");
      return;
    }
    if (active.analysisStatus === 'done' && String(active.spaceType || '') === String(spaceTypeText || '')) {
      await typeOutAI("呢張相我已經分析完成啦～你可以直接按「生成智能效果圖」。");
      return;
    }

    const analysisLoadingId = addLoadingToast("收到，圖片正在分析中，請稍等…", { loadingType: 'analyzing', uploadId });
    setAppState('ANALYZING');
    try {
      // Mark running + update spaceType; clear old analysis messages for this upload to avoid duplicates
      setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], spaceType: spaceTypeText, analysisStatus: 'running' } }) : prev);
      setMessages(prev => prev.filter(m => !(m.meta?.kind === 'analysis' && m.meta?.uploadId === uploadId)));

      const visionRes = await analyzeImage({
        imageDataUrl: active.dataUrl,
        mode: 'consultant',
        spaceType: spaceTypeText,
        clientId
      });

      if (visionRes.ok && visionRes.vision_summary) {
        setAnalysisSummary(visionRes.vision_summary);
        setAppState('ANALYSIS_DONE');
        stopLoadingToast(analysisLoadingId);
        setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], visionSummary: visionRes.vision_summary, analysisStatus: 'done' } }) : prev);

        await typeOutAI(
          `【圖片分析結果】\n${visionRes.vision_summary}\n\n想再分析另一張相？直接點左下角圖片按鈕再上傳就得～`,
          { options: ["生成智能效果圖"], meta: { kind: 'analysis', uploadId } }
        );
      } else {
        stopLoadingToast(analysisLoadingId);
        setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], analysisStatus: 'idle' } }) : prev);
        await typeOutAI("分析失敗，請重試。");
        setAppState('WAITING_FOR_SPACE');
      }
    } catch (e) {
      console.error(e);
      stopLoadingToast(analysisLoadingId);
      setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], analysisStatus: 'idle' } }) : prev);
      await typeOutAI("系統錯誤，請重試。");
      setAppState('WAITING_FOR_SPACE');
    }
  };

  const handleUpload = (file: File) => {
    // No Blob storage: keep payload smaller for stability (base64 only, in-session)
    compressImage(file, 1024, 0.75).then(blob => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            setActiveUploadId(uploadId);
            // Create the upload record immediately to avoid races with async upload returning early
            setUploads(prev => ({
                ...prev,
                [uploadId]: {
                    dataUrl,
                }
            }));

            // Show the latest uploaded image in chat immediately (user bubble)
            setMessages(prev => [
                ...prev,
                { id: `${uploadId}-upload`, type: 'image', content: dataUrl, sender: 'user', timestamp: Date.now(), meta: { kind: 'upload', uploadId } }
            ]);

            // Probe image dimensions (used to pick best StepFun output size)
            try {
                const img = new Image();
                img.onload = () => {
                    setUploads(prev => ({
                        ...prev,
                        [uploadId]: {
                            ...(prev[uploadId] || { dataUrl }),
                            dataUrl,
                            width: img.width,
                            height: img.height
                        }
                    }));
                    setAppState('WAITING_FOR_SPACE');
                    // Auto classify space, then ask user to confirm with buttons (more robust than free text)
                    (async () => {
                      const classifyId = addLoadingToast("我先幫你判斷呢張相係咩空間，請稍等…", { loadingType: 'classifying', uploadId });
                      try {
                        const sres = await classifySpace({ imageDataUrl: dataUrl, clientId });
                        stopLoadingToast(classifyId);
                        const primary = (sres.ok && sres.primary) ? sres.primary : '其他';
                        const options = (() => {
                          const cand = (sres.candidates || []).map(c => String(c.space)).filter(Boolean);
                          const base = [primary, ...cand, '客厅', '餐厅', '卧室', '厨房', '玄关', '书房', '卫生间', '走廊', '其他'];
                          const uniq: string[] = [];
                          for (const x of base) {
                            const v = String(x).trim();
                            if (!v) continue;
                            if (!uniq.includes(v)) uniq.push(v);
                            if (uniq.length >= 8) break;
                          }
                          return uniq;
                        })();

                        await typeOutAI(
                          `我猜你呢張相係「${primary}」\n你點一下確認就得（唔啱都可以改）`,
                          { options, meta: { kind: 'space_pick', uploadId } }
                        );
                      } catch (err) {
                        stopLoadingToast(classifyId);
                        addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客厅/餐厅/卧室/厨房/玄关/书房/其他）");
                      }
                    })();
                };
                img.onerror = () => {
                    setUploads(prev => ({
                        ...prev,
                        [uploadId]: {
                            ...(prev[uploadId] || { dataUrl }),
                            dataUrl,
                        }
                    }));
                    setAppState('WAITING_FOR_SPACE');
                    addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客厅/餐厅/卧室/厨房/玄关/书房/其他）");
                };
                img.src = dataUrl;
            } catch {
                setUploads(prev => ({
                    ...prev,
                    [uploadId]: {
                        ...(prev[uploadId] || { dataUrl }),
                        dataUrl,
                    }
                }));
                setAppState('WAITING_FOR_SPACE');
                addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客厅/餐厅/卧室/厨房/玄关/书房/其他）");
            }
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
        const uid = activeUploadId;
        if (!uid) {
          addSystemToast("搵唔到你最新上傳嗰張相，麻煩你再上傳一次～");
          setAppState('START');
          return;
        }
        await runAnalysisForUpload(uid, text);
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

          const baseUrl =
            revisionText
              ? (lastGeneratedImage || (intakeData?.baseImageBlobUrl ?? ''))
              : (intakeData?.baseImageBlobUrl ?? '');

              const jobId =
                // @ts-ignore
                (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                  // @ts-ignore
                  ? crypto.randomUUID()
                  : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

              const payload = {
              prompt: '', 
              renderIntake: intakeData || {}, 
              baseImageBlobUrl: baseUrl,
              size: pickStepFunSize(intakeData?.baseWidth, intakeData?.baseHeight),
              // URL response is smaller and more stable; server will persist to Blob when possible.
              response_format: 'url',
              clientId,
              uploadId: intakeData?.uploadId,
              jobId,
              // StepFun doc: smaller source_weight => more similar to source (less deformation)
                  source_weight: intakeData?.source_weight ?? 0.4,
                  steps: intakeData?.steps ?? 40,
                  cfg_scale: intakeData?.cfg_scale ?? 6.0
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

              // Explanation should align to the actual prompt/spec used by backend
              const explain =
                res.designExplanation
                  ? `【設計說明】\n${res.designExplanation}\n\n想要我哋按你單位尺寸出更準嘅櫃體分區、五金配置同報價？直接點右上角「免費跟進」WhatsApp，我哋同事一對一跟進～`
                  : [
                      `【設計說明】`,
                      `- 風格：${intakeData?.style || '（按你選擇）'}；色系：${intakeData?.color || '（按你選擇）'}`,
                      `- 佈局重點：已按你選擇的重點區域/收納取向去做櫃體規劃`,
                      `- 櫃體/收納：建議做全高櫃/餐邊櫃/收納牆，分區包含展示＋封閉收納（避免雜亂）`,
                      `- 天花/燈光：用燈槽/筒燈做層次，必要位置加吊燈/壁燈`,
                      `- 地面/牆面：地面用木地板或耐磨磚；牆面用淺色耐污材質更易打理`,
                      ``,
                      `想要我哋按你單位尺寸出更準嘅櫃體分區、五金配置同報價？直接點右上角「免費跟進」WhatsApp，我哋同事一對一跟進～`
                    ].join('\n');
              await typeOutAI(explain);
          } else {
              // Handle "already running" case (idempotency / concurrency)
              if ((res as any)?.errorCode === 'IN_PROGRESS') {
                  throw new Error('呢個效果圖仲生成緊，你等我幾秒先～');
              }
              throw new Error(res.message);
          }
      } catch (e: any) {
          addSystemToast(`生成失敗：${e.message}`);
          setAppState('ANALYSIS_DONE'); // Revert state
      }
  };

  const handleOptionClick = async (message: Message, opt: string) => {
      const uploadId = message.meta?.uploadId;
      const u = uploadId ? uploads[uploadId] : undefined;

      if (message.meta?.kind === 'space_pick' && uploadId) {
          // Lock this message to prevent double-trigger
          if (message.isLocked) return;
          setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isLocked: true } : m));
          await runAnalysisForUpload(uploadId, opt);
          return;
      }

      if (opt === '生成智能效果圖') {
          // Prevent repeated taps from spamming; but don't make it "no response"
          if (message.isLocked) {
              await typeOutAI("收到～我已經開始處理緊，你等我幾秒先～");
              return;
          }

          // If blob URL not ready, guide user to wait to avoid "Missing baseImageBlobUrl"
          if (!uploadId || !u) {
              await typeOutAI("搵唔到對應嘅相片，麻煩你再上傳一次～");
              return;
          }
          // Lock this message after we confirm we can start the flow
          setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isLocked: true } : m));

          // Prefer public URL; silently fallback to base64 if upload URL isn't ready/failed.

          // Start clickable intake flow in chat
          await typeOutAI("想做咩風格先？你可以先揀一個～", {
              options: ["現代簡約", "奶油風", "日式木系", "輕奢"],
              meta: { kind: 'render_flow', stage: 'style', uploadId }
          });
          return;
      }

      // Render flow steps (bound to the analysis/upload)
      if (message.meta?.kind === 'render_flow' && uploadId && u) {
          if (message.meta.stage === 'style') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), style: opt } }
              }) : prev);
              await typeOutAI("色系想走邊種？", {
                  options: ["淺木+米白", "胡桃木+灰白", "純白+淺灰", "深木+暖白"],
                  meta: { kind: 'render_flow', stage: 'color', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'color') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), color: opt } }
              }) : prev);
              const space = u.spaceType || '';
              const isDining = String(space).includes('餐');
              const isKitchen = String(space).includes('廚') || String(space).includes('厨');
              const isEntrance = String(space).includes('玄') || String(space).includes('關') || String(space).includes('关');
              const focusOptions = isDining
                ? ["餐桌佈局+動線", "餐邊櫃/高櫃收納", "展示+收納牆", "全屋整體"]
                : isKitchen
                  ? ["廚櫃動線+收納", "高櫃電器櫃", "餐邊/島台", "全屋整體"]
                  : isEntrance
                    ? ["鞋櫃+換鞋位", "收納+展示", "雜物/清潔櫃", "全屋整體"]
                    : ["電視牆收納", "高櫃/衣櫃收納", "書枱/工作位", "全屋整體"];

              await typeOutAI("呢張圖你最想改邊個位置（重點做櫃體收納）？", {
                  options: focusOptions,
                  meta: { kind: 'render_flow', stage: 'focus', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'focus') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), focus: opt } }
              }) : prev);

              await typeOutAI("你想收納取向係邊種？", {
                  options: ["隱藏收納為主", "收納+展示", "收納+書枱/工作位"],
                  meta: { kind: 'render_flow', stage: 'storage', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'storage') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), storage: opt } }
              }) : prev);

              await typeOutAI("你更重視邊個取向？", {
                  options: ["性價比優先", "耐用優先", "易打理優先"],
                  meta: { kind: 'render_flow', stage: 'priority', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'priority') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), priority: opt } }
              }) : prev);

              await typeOutAI("想改造得幾明顯？（越明顯，變化越大但可能更易走樣）", {
                  options: ["保留結構（輕改）", "明顯改造（推薦）", "大改造（更大變化）"],
                  meta: { kind: 'render_flow', stage: 'intensity', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'intensity') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), intensity: opt } }
              }) : prev);

              const style = u.render?.style || '現代簡約';
              const color = u.render?.color || '淺木+米白';
              const focus = u.render?.focus || '全屋整體';
              const storage = u.render?.storage || '隱藏收納為主';
              await typeOutAI(`好，我幫你用「${style}｜${color}｜${focus}｜${storage}」出一張效果圖（保留原本門窗/梁柱/結構）。準備好就按下面開始生成～`, {
                  options: ["開始生成效果圖"],
                  meta: { kind: 'render_flow', stage: 'confirm', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'confirm' && opt === '開始生成效果圖') {
              const style = u.render?.style || '現代簡約';
              const color = u.render?.color || '淺木+米白';
              const priority = u.render?.priority || '性價比優先';
              const focus = u.render?.focus || '全屋整體';
              const storage = u.render?.storage || '隱藏收納為主';
              const intensity = u.render?.intensity || '明顯改造（推薦）';

              const genLoadingId = addLoadingToast("收到～我而家幫你生成效果圖，請稍等…", { loadingType: 'generating', uploadId });
              setAppState('GENERATING');

              const baseImage = u.dataUrl;
              // Tune parameters by intensity (StepFun doc: smaller source_weight => closer to source)
              const intensityParams = (() => {
                  // We need visible, "real render" changes: slightly stronger defaults.
                  if (intensity.includes('輕改')) return { source_weight: 0.46, cfg_scale: 6.8, steps: 45 };
                  if (intensity.includes('大改造')) return { source_weight: 0.66, cfg_scale: 8.2, steps: 55 };
                  return { source_weight: 0.58, cfg_scale: 7.8, steps: 52 }; // recommended
              })();

              const pickConstraints = (summary?: string) => {
                  if (!summary) return '';
                  const lines = summary.split('\n').map(l => l.trim()).filter(Boolean);
                  // Prefer "結構/特徵/香港" lines only
                  const picked = lines.filter(l => l.startsWith('結構：') || l.startsWith('特徵：') || l.includes('窗') || l.includes('梁') || l.includes('冷氣') || l.includes('柱') || l.includes('窗台'));
                  const text = (picked.length ? picked : lines.slice(0, 6)).join('；');
                  return text.length > 220 ? text.slice(0, 220) + '…' : text;
              };
              const structureNotes = u.visionSummary ? `Constraints: ${pickConstraints(u.visionSummary)}` : '';

              const space = u.spaceType || 'room';
              const isDining = String(space).includes('餐') || String(space).toLowerCase().includes('dining');
              const diningMustHave = isDining
                ? `\nDining must-have: place a dining table and chairs appropriately (clear circulation), add a dining sideboard / tall pantry storage as suitable.`
                : '';

              // Keep requirements concise to avoid StepFun prompt >1024
              const requirements = [
                  `Priority: ${priority}. Focus: ${focus}. Storage: ${storage}. Intensity: ${intensity}.`,
                  `INTERIOR ONLY (ignore balcony/exterior).`,
                  `Must include: cabinetry/storage plan + dining table/sideboard if dining; ceiling + floor + wall finish + lighting + soft furnishings.`,
                  `Do NOT move windows/doors/beams/columns; keep camera perspective.`,
                  `Material: ENF-grade multi-layer wood/plywood cabinetry.`,
                  structureNotes ? structureNotes : ''
              ].filter(Boolean).join(' ');

              const intake = {
                  space,
                  style,
                  color,
                  // Send structured selections to backend for better prompt alignment
                  focus,
                  storage,
                  priority,
                  intensity,
                  requirements,
                  // Pass vision summary for layout constraints (no persistence; used for this generation only)
                  visionSummary: u.visionSummary,
                  uploadId,
                  baseImageBlobUrl: baseImage,
                  baseWidth: u.width,
                  baseHeight: u.height,
                  source_weight: intensityParams.source_weight,
                  cfg_scale: intensityParams.cfg_scale,
                  steps: intensityParams.steps
              };

              try {
                  await triggerGeneration(intake);
              } finally {
                  stopLoadingToast(genLoadingId);
              }
          }
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
