import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from './components/AppShell';
import { AppBar } from './components/AppBar';
import { StartScreen } from './components/StartScreen';
import { MessageCard } from './components/MessageCard';
import { Composer } from './components/Composer';
import { Message } from './types';
import { analyzeImage } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateInspireImage, qaDesignImage, uploadImage } from './services/generateClient';
import { compressImage } from './services/utils';
import { classifySpace } from './services/spaceClient';

const App: React.FC = () => {
  // --- State ---
  const [appState, setAppState] = useState<'START' | 'WAITING_FOR_SPACE' | 'ANALYZING' | 'ANALYSIS_DONE' | 'RENDER_INTAKE' | 'GENERATING' | 'RENDER_DONE'>('START');
  const [clientId, setClientId] = useState<string>(''); // per-device user id
  
  const [uploads, setUploads] = useState<Record<string, {
    dataUrl: string;
    imageUrl?: string; // Prefer public URL (Blob) for analysis/i2i stability
    width?: number;
    height?: number;
    spaceType?: string;
    visionSummary?: string;
    visionExtraction?: any;
    // Layout suggestions inferred from vision (2-3 options). Used as the FIRST-STEP before generation.
    layoutOptions?: string[];
    layoutRecommended?: string;
    fixedConstraints?: string[];
    analysisStatus?: 'idle' | 'running' | 'done';
    render?: {
      style?: string;
      color?: string;
      focus?: string;
      storage?: string;
      priority?: string;
      intensity?: string;
      hallType?: '标准厅' | '钻石厅' | '长厅' | '不确定';
    };
  }>>({});
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(null);
  // Keep the last used render intake so "再精修" can regenerate via t2i.
  const lastRenderIntakeRef = useRef<any>(null);
  
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
        imageUrl: active.imageUrl,
        imageDataUrl: active.imageUrl ? undefined : active.dataUrl,
        mode: 'consultant',
        spaceType: spaceTypeText,
        clientId
      });

      if (visionRes.ok && visionRes.vision_summary) {
        setAnalysisSummary(visionRes.vision_summary);
        setAppState('ANALYSIS_DONE');
        stopLoadingToast(analysisLoadingId);
        const ex: any = (visionRes as any)?.extraction;
        const rawOpts: any[] = Array.isArray(ex?.layout_options) ? ex.layout_options : [];
        const recIdx = Number.isInteger(ex?.recommended_index) ? ex.recommended_index : 0;

        const compact = (s: string, max = 88) => {
          const t = String(s || '').replace(/\s+/g, ' ').trim();
          return t.length > max ? t.slice(0, max - 1) + '…' : t;
        };
        const toOptionText = (o: any, idx: number) => {
          const title = String(o?.title || `方案${idx + 1}`).trim();
          const plan = String(o?.plan || '').trim();
          const cab = String(o?.cabinetry || '').trim();
          const circ = String(o?.circulation || '').trim();
          const light = String(o?.lighting || '').trim();
          const parts = [
            `${title}：${plan || '（未见）'}`,
            cab ? `柜：${cab}` : '',
            circ ? `动线：${circ}` : '',
            light ? `灯：${light}` : ''
          ].filter(Boolean);
          return compact(parts.join('｜'));
        };

        // Standardized: show exactly 2 options (A/B) for HK units
        const layoutOptions = rawOpts.slice(0, 2).map(toOptionText).filter(Boolean);
        const layoutRecommended = rawOpts[recIdx] ? toOptionText(rawOpts[recIdx], recIdx) : undefined;
        const fixedConstraints = Array.isArray(ex?.fixed_constraints) ? ex.fixed_constraints.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 6) : undefined;

        setUploads(prev => prev[uploadId]
          ? ({
              ...prev,
              [uploadId]: {
                ...prev[uploadId],
                visionSummary: visionRes.vision_summary,
                visionExtraction: ex,
                layoutOptions: layoutOptions.length ? layoutOptions : undefined,
                layoutRecommended,
                fixedConstraints,
                analysisStatus: 'done'
              }
            })
          : prev
        );

        await typeOutAI(
          `【图片分析】\n${visionRes.vision_summary}\n点「生成智能效果图」继续。`,
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
    // Prefer URL-first (Vercel Blob) for Stepfun vision/i2i stability; fallback to base64-only if upload fails.
    compressImage(file, 1024, 0.75).then(blob => {
        let uploadedUrl: string | undefined;
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

            // Fire-and-forget: try to upload to Blob to obtain a public URL for downstream APIs.
            // If it fails (e.g. local dev without token), we keep using base64.
            (async () => {
              try {
                const up = await uploadImage(blob, { clientId, uploadId });
                const url = up?.url;
                if (url) {
                  uploadedUrl = url;
                  setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], imageUrl: url } }) : prev);
                }
              } catch {
                // ignore
              }
            })();

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
                        const sres = await classifySpace({ imageUrl: uploadedUrl, imageDataUrl: uploadedUrl ? undefined : dataUrl, clientId });
                        stopLoadingToast(classifyId);
                        const primary = (sres.ok && sres.primary) ? sres.primary : '其他';
                        const options = (() => {
                          const cand = (sres.candidates || []).map(c => String(c.space)).filter(Boolean);
                          // HK-friendly fixed taxonomy
                          const base = [primary, ...cand, '客餐厅', '大睡房', '小睡房', '厨房', '卫生间', '入户', '走廊', '其他'];
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
                        addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他）");
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
                    addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他）");
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
                addSystemToast("收到～想確認一下：呢張相係邊個空間？（例如：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他）");
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

  // --- HK-friendly i2i helpers (non-sensitive, photorealistic, keep structure) ---
  const normalizeSpaceKey = (space?: string) => String(space || '').trim();

  const getPaletteOptionsForStyle = (style?: string) => {
      const s = String(style || '').trim();
      if (s.includes('奶油')) {
          return ["奶油白+浅木", "奶油白+暖灰", "奶油白+浅胡桃"];
      }
      if (s.includes('日式') || s.includes('木')) {
          return ["浅木+米白", "原木+暖白", "胡桃木+米白"];
      }
      if (s.includes('輕奢') || s.includes('轻奢')) {
          return ["胡桃木+灰白（香槟金点缀）", "深木+暖白（黑钛点缀）", "纯白+浅灰（香槟金点缀）"];
      }
      // 现代简约 / 默认
      return ["浅木+米白", "胡桃木+灰白", "纯白+浅灰", "深木+暖白"];
  };

  const getDefaultStyleForHK = () => "現代簡約";
  const getDefaultColorForHK = (style?: string) => getPaletteOptionsForStyle(style)[0] || "浅木+米白";
  // HK-friendly style+tone combos (fast selection right after layout)
  const getStyleToneOptionsHK = () => ([
    "現代簡約｜浅木+米白",
    "現代簡約｜纯白+浅灰",
    "奶油風｜奶油白+浅木",
    "日式木系｜原木+暖白",
    "輕奢｜胡桃木+灰白（香槟金点缀）",
    "深木暖調｜深木+暖白",
  ]);

  const parseStyleTone = (opt: string) => {
    const t = String(opt || '').trim();
    const parts = t.split('｜').map(s => s.trim()).filter(Boolean);
    const style = parts[0] || '';
    const color = parts[1] || '';
    return { style, color };
  };

  const getDefaultVibeForHK = () => "明亮通透";
  const getDefaultDecorForHK = () => "標準搭配（推薦）";
  const getDefaultIntensityForHK = () => "明顯改造（推薦）";
  const getDefaultStorageForSpace = (space?: string) => {
      const s = normalizeSpaceKey(space);
      if (s.includes('厨房') || s.includes('廚') || s.includes('厨')) return "台面整洁收纳（隐藏小家电）";
      if (s.includes('卫') || s.includes('衛') || s.includes('卫生间') || s.includes('洗手') || s.includes('厕') || s.includes('廁')) return "镜柜+壁龛（更好用）";
      return "隐藏收纳为主";
  };

  const isLivingDiningSpace = (space?: string) => {
      const s = normalizeSpaceKey(space);
      return s.includes('客餐') || s === '客餐厅' || (s.includes('客') && s.includes('餐'));
  };

  const pickLayoutOptionsHK = (space?: string, hallType?: string) => {
      const options = getLayoutOptionsForSpace(space);
      const h = String(hallType || '').trim();
      if (!options.length) return options;
      if (!h || h.includes('不确定') || h.includes('标准')) return options.slice(0, 3);

      const score = (opt: string) => {
          const t = String(opt || '');
          let s = 0;
          // Diamond living-dining: avoid heavy TV wall, prefer thinner cabinets & clear circulation
          if (h.includes('钻石')) {
              if (t.includes('不压迫') || t.includes('薄柜') || t.includes('動線') || t.includes('动线') || t.includes('通道')) s += 3;
              if (t.includes('餐区主导') || t.includes('餐桌居中')) s += 2;
              if (t.includes('L型') || t.includes('長牆') || t.includes('长墙')) s += 1;
          }
          // Long hall: prioritize long-wall TV + clear corridor
          if (h.includes('长')) {
              if (t.includes('長牆') || t.includes('长墙') || t.includes('動線') || t.includes('动线') || t.includes('留通道') || t.includes('通道')) s += 3;
              if (t.includes('餐边高柜') || t.includes('餐邊高櫃') || t.includes('靠近厨房') || t.includes('过道')) s += 2;
          }
          return s;
      };

      const ranked = options
          .map(o => ({ o, s: score(o) }))
          .sort((a, b) => b.s - a.s)
          .map(x => x.o);
      // If scoring didn't help, fall back to first 3
      const top = ranked.slice(0, 3);
      return top.every(x => score(x) === 0) ? options.slice(0, 3) : top;
  };

  const inferBedTypeFromLayout = (layoutText?: string) => {
      const t = String(layoutText || '');
      if (!t) return '';
      if (t.includes('榻榻米')) return '榻榻米';
      if (t.includes('地台')) return '地台床';
      if (t.includes('活动床') || t.includes('活動床')) return '活动床/隐形床';
      if (t.includes('隐形床') || t.includes('隱形床') || t.includes('Murphy')) return '活动床/隐形床';
      if (t.includes('标准') || t.includes('標準')) return '标准双人床';
      return '';
  };

  const getLayoutOptionsForSpace = (space?: string) => {
      const s = normalizeSpaceKey(space);
      const isLivingDining = s.includes('客餐');
      const isKitchen = s.includes('厨房') || s.includes('廚') || s.includes('厨');
      const isEntrance = s.includes('入户') || s.includes('玄') || s.includes('關') || s.includes('关');
      const isCorridor = s.includes('走廊') || s.includes('通道');
      const isBathroom = s.includes('卫') || s.includes('衛') || s.includes('卫生间') || s.includes('洗手') || s.includes('厕所') || s.includes('廁');
      const isMasterBed = s.includes('大睡房') || s.includes('主人房') || s.includes('主卧');
      const isSmallBed = s.includes('小睡房') || s.includes('次卧') || s.includes('儿童房') || s.includes('眼镜房');
      const isBedroom = isMasterBed || isSmallBed || s.includes('卧') || s.includes('睡') || s.includes('房');

      if (isLivingDining) {
          return [
              "客餐厅：电视墙在对窗墙｜沙发对电视｜餐桌靠窗侧｜餐边柜靠近餐桌",
              "客餐厅：电视墙在长墙｜沙发L型靠墙｜餐桌靠入户侧｜餐边高柜靠近厨房/过道",
              "客餐厅：餐区主导（餐桌居中）｜餐边高柜到顶｜电视墙做薄柜不压迫",
              "客餐厅：电视墙+展示酒柜一体｜餐边柜做电器高柜（咖啡角）｜动线留通道"
          ];
      }
      if (isKitchen) {
          return [
              "厨房：一字型（水槽-备餐-炉头）｜吊柜到顶＋底灯",
              "厨房：L型转角（水槽与炉头分开）｜转角五金＋吊柜到顶",
              "厨房：U型（如空间允许）｜台面最大化＋高柜电器位"
          ];
      }
      if (isBathroom) {
          return [
              "卫生间：干湿分离｜淋浴屏靠里｜浴室柜＋镜柜在门口侧",
              "卫生间：一字型布局｜浴室柜对门｜淋浴区靠窗/靠里｜壁龛收纳",
              "卫生间：浴室柜外侧更干爽（如可行）｜镜前灯＋防滑砖"
          ];
      }
      if (isEntrance) {
          return [
              "入户：进门侧到顶鞋柜＋换鞋凳｜全身镜靠近出门动线｜杂物位内收",
              "入户：鞋柜到顶＋中段开放格（钥匙/包）｜底部留空放常穿鞋",
              "入户：薄鞋柜＋高柜清洁位（吸尘器/拖把）｜保留净通道"
          ];
      }
      if (isCorridor) {
          return [
              "走廊：单侧25–30cm浅柜到顶｜不压迫｜端头做展示格＋灯带",
              "走廊：墙面同色隐形门＋局部壁龛｜线性灯/洗墙光拉长空间",
              "走廊：清洁高柜＋杂物浅柜组合｜净通道优先"
          ];
      }
      if (isBedroom) {
          if (isSmallBed) {
              return [
                  "小睡房：地台床＋到顶衣柜（薄柜）｜窗边转角书桌一体（省位）",
                  "小睡房：榻榻米（升降/抽屉）＋衣柜到顶｜书桌靠窗不挡窗帘",
                  "小睡房：活动床/隐形床＋衣柜到顶｜白天留出工作区/通道",
                  "小睡房：标准床靠墙｜衣柜做趟门｜床尾留净通道"
              ];
          }
          // 大睡房/通用睡房
          return [
              "睡房：床头靠实墙｜两侧留床头位｜到顶衣柜在侧墙",
              "睡房：床靠窗侧（避开窗帘轨）｜衣柜做趟门不占通道",
              "睡房：衣柜＋梳妆/书桌一体（窗边）｜床头背景＋壁灯",
          ];
      }
      // default fallback
      return [
          "布置：主功能靠墙摆放｜通道清晰｜柜体到顶收纳＋分层灯光",
          "布置：收纳优先（到顶高柜）｜留净通道｜局部展示格+灯带"
      ];
  };

  const getSuiteOptionsForSpace = (space?: string) => {
      const s = normalizeSpaceKey(space);
      const isLivingDining = s.includes('客餐') || (s.includes('客') && s.includes('餐'));
      const isKitchen = s.includes('廚') || s.includes('厨') || s.includes('厨房');
      const isEntrance = s.includes('入户') || s.includes('玄') || s.includes('關') || s.includes('关');
      const isCorridor = s.includes('走廊') || s.includes('通道');
      const isBathroom = s.includes('卫') || s.includes('衛') || s.includes('卫生间') || s.includes('洗手') || s.includes('厕所') || s.includes('廁');
      const isMasterBed = s.includes('大睡房') || s.includes('主人房') || s.includes('主卧');
      const isSmallBed = s.includes('小睡房') || s.includes('次卧') || s.includes('儿童房') || s.includes('眼镜房');
      const isBedroom = isMasterBed || isSmallBed || s.includes('卧') || s.includes('睡') || s.includes('房') || s.includes('床');

      if (isKitchen) {
          return [
              "吊櫃到頂＋高櫃電器櫃",
              "台面整潔收納（隱藏小家電）",
              "轉角五金優化（轉角籃）",
              "星盆區收納（分類/拉籃）",
              "爐頭區調味收納（窄拉籃）",
              "全屋統一質感（牆地頂＋燈光＋軟裝）"
          ];
      }
      if (isBathroom) {
          return [
              "浴室櫃＋鏡櫃收納",
              "高櫃毛巾/清潔收納",
              "洗衣機高櫃一體（如可行）",
              "乾濕分區質感（玻璃/暖光）",
              "壁龕/置物收納",
              "全屋統一質感（牆地頂＋燈光＋軟裝）"
          ];
      }
      if (isEntrance) {
          return [
              "入戶鞋櫃到頂＋換鞋凳＋全身鏡",
              "鞋櫃＋全身鏡＋雜物高櫃",
              "清潔高櫃（吸塵器/拖把位）",
              "入戶收納一體（雨傘/包包/鑰匙位）",
              "展示＋收納（局部展示格）",
              "全屋統一質感（牆地頂＋燈光＋軟裝）"
          ];
      }
      if (isCorridor) {
          return [
              "走廊淺櫃收納（不壓迫）",
              "走廊牆面收納＋展示格（局部）",
              "清潔高櫃（吸塵器/拖把位）",
              "隱藏門/同色牆面（視覺更整齊）",
              "線性燈＋洗牆光（拉長空間）",
              "全屋統一質感（牆地頂＋燈光＋軟裝）"
          ];
      }
      if (isBedroom) {
          return [
              isMasterBed ? "大睡房：到頂衣櫃（掛衣＋抽屜＋被鋪位）" : "小睡房：到頂衣櫃＋床/書枱一體（省位）",
              isSmallBed ? "小睡房：榻榻米/地台床收納" : "床底收納/床箱（提升收納）",
              isSmallBed ? "小睡房：活動床/隱形床（更實用）" : "梳妝/書枱位（如需要）",
              "衣櫃＋書枱一體（窗邊/轉角）",
              "床頭收納牆（護牆＋壁燈）",
              "全屋統一質感（牆地頂＋燈光＋軟裝）"
          ];
      }
      // Living-dining combined (HK common)
      if (isLivingDining) {
          return [
              "客餐厅：電視牆收納（到頂＋展示格）",
              "客餐厅：餐桌佈局＋動線（清晰通道）",
              "客餐厅：餐邊櫃＋高櫃收納（咖啡/小家電）",
              "客餐厅：酒櫃/展示櫃（局部＋燈帶）",
              "客餐厅：收納牆（整面到頂）",
              "全屋統一質感（牆地頂＋燈光＋軟裝）"
          ];
      }
      return [
          "電視牆收納（到頂＋展示格）",
          "餐邊櫃＋高櫃收納（如合適）",
          "收納牆（整面到頂）",
          "玄關鞋櫃一體（如相連）",
          "書枱/工作位（如需要）",
          "全屋統一質感（牆地頂＋燈光＋軟裝）"
      ];
  };

  const isBedroomLike = (space?: string, focus?: string) => {
      const s = normalizeSpaceKey(space);
      const f = String(focus || '').trim();
      const hit = (t: string) => s.includes(t) || f.includes(t);
      return (
          hit('卧') ||
          hit('睡') ||
          hit('房') ||
          hit('床') ||
          hit('衣櫃') ||
          hit('衣柜') ||
          hit('榻榻米') ||
          hit('地台') ||
          hit('活動床') ||
          hit('活动床') ||
          hit('隱形床') ||
          hit('隐形床')
      );
  };

  const isBareShellFromSummary = (summary?: string) => {
      const s = String(summary || '');
      if (!s) return false;
      // Prefer explicit marker from Vision: "完成度：毛坯/半装/已装"
      if (s.includes('完成度')) {
        if (s.includes('完成度：毛坯') || s.includes('完成度:毛坯') || s.includes('完成度： 清水') || s.includes('完成度：清水')) return true;
        if (s.includes('完成度：已装') || s.includes('完成度：已裝') || s.includes('完成度：精装') || s.includes('完成度：精裝')) return false;
        // 半装按“非毛坯”处理（后端会做更细分流）
        if (s.includes('完成度：半装') || s.includes('完成度：半裝')) return false;
      }
      return [
          '毛坯', '清水', '未裝修', '未装修', '水泥', '批蕩', '批荡', '工地', '裸牆', '裸墙', '空置', '空房',
          'bare', 'unfinished', 'construction', 'raw'
      ].some(k => s.toLowerCase().includes(k.toLowerCase()));
  };

  const suiteToPrompt = (space: string, focus: string, storage: string) => {
      const f = String(focus || '');
      const s = String(space || '');
      const isKitchen = s.includes('廚') || s.includes('厨');
      const isBathroom = s.includes('浴') || s.includes('衛') || s.includes('卫') || s.includes('洗手') || s.includes('厕所') || s.includes('廁');
      const isDining = s.includes('餐') || s.toLowerCase().includes('dining');
      const storageHint = storage.includes('展示')
        ? 'Mix closed cabinetry with a few open shelves/display niches; keep it balanced (not cluttered).'
        : storage.includes('書枱') || storage.includes('书台') || storage.includes('工作位')
          ? 'Include integrated desk/workstation + shelving where suitable; keep circulation clear.'
          : 'Prioritize closed storage (hidden, clean look); minimize visual clutter.';

      if (isKitchen) {
          return [
              'Kitchen cabinetry must be practical for HK homes: base cabinets + wall cabinets (prefer ceiling-height) + tall pantry/appliance tower when possible.',
              'Keep sink/stove/plumbing/gas/exhaust positions unchanged; do not block access panels.',
              f.includes('台面') ? 'Make countertop look clean: add hidden/organized small-appliance storage and proper task lighting.' : '',
              f.includes('轉角') || f.includes('转角') ? 'Optimize corner with suitable corner hardware (lazy susan/magic corner) and avoid dead corners.' : '',
              f.includes('星盆') || f.includes('洗') ? 'Optimize sink zone storage (pull-out bins, cleaning organizers) without moving plumbing.' : '',
              f.includes('爐頭') || f.includes('炉') ? 'Add narrow pull-out spice rack near cooking zone; keep clearances safe.' : '',
              storageHint
          ].filter(Boolean).join(' ');
      }

      if (isBathroom) {
          return [
              'Bathroom must look realistic and buildable: vanity cabinet + mirror cabinet; moisture-resistant finishes.',
              'Keep plumbing/drain locations unchanged; do not block access.',
              f.includes('洗衣機') || f.includes('洗衣') ? 'If the photo layout allows, integrate washer tower/upper cabinet; keep ventilation.' : '',
              f.includes('乾濕') || f.includes('干湿') ? 'Add simple wet/dry separation (glass partition) with warm lighting; keep it HK-practical.' : '',
              f.includes('壁龕') || f.includes('壁龛') ? 'Add recessed niches/shelves where plausible (do not change structure).' : '',
              storageHint
          ].filter(Boolean).join(' ');
      }

      if (isDining) {
          return [
              'Include dining table and chairs with clear circulation (HK-sized, practical).',
              f.includes('餐邊') ? 'Add dining sideboard + tall storage for small appliances/coffee corner.' : '',
              f.includes('展示') ? 'Add a small display niche / glass cabinet section (not too much).' : '',
              storageHint
          ].filter(Boolean).join(' ');
      }

      // Living/Bedroom/Entrance/Other (use focus text heuristics)
      return [
          f.includes('電視') ? 'Add a TV feature wall with built-in storage: low TV cabinet + tall side cabinets to ceiling + a few display niches; conceal wiring.' : '',
          f.includes('餐邊') ? 'Add a dining sideboard + tall cabinet for appliance storage when suitable for the space.' : '',
          f.includes('玄關') || f.includes('鞋') ? 'Add entry shoe cabinet to ceiling + bench + full-length mirror; keep door swing clear.' : '',
          f.includes('走廊') ? 'Use shallow corridor storage (reduce depth) to keep passage comfortable.' : '',
          f.includes('衣櫃') || f.includes('衣柜') || f.includes('衣櫥') ? 'Add full-height wardrobe with balanced hanging/drawers/bedding storage; keep window/AC access.' : '',
          f.includes('榻榻米') || f.includes('地台') ? 'Add tatami/platform bed storage (drawers/lift-up) integrated with wardrobe; keep it photorealistic.' : '',
          (f.includes('活動') || f.includes('隐形') || f.includes('隱形')) ? 'If suitable, add a practical Murphy/hidden bed solution integrated with cabinetry.' : '',
          f.includes('書枱') || f.includes('书台') || f.includes('工作位') ? 'Add integrated desk/workstation + shelving, aligned to the room layout; keep circulation.' : '',
          f.includes('床頭') ? 'Add headboard feature with warm wall lights and slim storage (HK-friendly).' : '',
          f.includes('全屋統一') || f.includes('全屋统一') ? 'Upgrade overall finishes: ceiling design + lighting + wall paint + flooring + soft furnishings; keep cabinetry coordinated.' : '',
          storageHint
      ].filter(Boolean).join(' ');
  };

  const triggerGeneration = async (intakeData: any, revisionText?: string) => {
      try {
          if (intakeData && typeof intakeData === 'object') {
            lastRenderIntakeRef.current = intakeData;
          }
          const pickStepFunSize = (w?: number, h?: number) => {
              if (!w || !h) return '1280x800';
              const ratio = w / h;
              // Prefer 16:9 sizes for room photos; use square only if close to square.
              if (ratio > 1.15) return '1280x800';
              if (ratio < 0.87) return '800x1280';
              return '1024x1024';
          };

          const base = intakeData || lastRenderIntakeRef.current || {};
          const uploadId = base?.uploadId;
          const size = pickStepFunSize(base?.baseWidth, base?.baseHeight);

          // For revision, keep previous selections and append modification note
          const renderIntake = revisionText
            ? ({ ...(base || {}), requirements: `${String(base?.requirements || '').trim()}\n\n修改要求：${revisionText}`.trim() })
            : base;

          // Single t2i generation as the FINAL render (faster for free trial UX)
          const genLoadingId = addLoadingToast("收到～我而家幫你生成效果圖，請稍等…", { loadingType: 'generating', uploadId });
          try {
            const res = await generateInspireImage({
              renderIntake,
              size,
              response_format: 'url',
              // Keep it reasonably fast
              steps: 28,
              cfg_scale: 6.6,
            });
            stopLoadingToast(genLoadingId);

            if (!res.ok || !res.resultUrl) {
              throw new Error(res.message || '生成失败');
            }

            const resultUrl = res.resultUrl;
            setLastGeneratedImage(resultUrl);
            setAppState('RENDER_DONE');
            setMessages(prev => [
              ...prev,
              { id: `${Date.now()}-img`, type: 'image', content: resultUrl, sender: 'ai', timestamp: Date.now() }
            ]);

            const refineOptions = ["再精修：灯光更高级", "再精修：柜体更清晰", "再精修：软装更丰富"];
            const bgId = addLoadingToast("效果圖已出，我再幫你做一次智能复核并补充设计说明…", { loadingType: 'analyzing', uploadId });
            try {
              const qaRes = await qaDesignImage({ imageUrl: resultUrl, renderIntake });
              stopLoadingToast(bgId);
              if (qaRes.ok && qaRes.designExplanation) {
                await typeOutAI(
                  `【設計說明（按最终效果图）】\n${qaRes.designExplanation}\n\n想再精修？點下面一個：`,
                  { options: refineOptions, meta: { kind: 'generated', uploadId } }
                );
              } else {
                await typeOutAI(`【設計說明】\n- 说明生成暂时失败，但效果图已生成；你可直接点下面再生成优化。`, {
                  options: refineOptions,
                  meta: { kind: 'generated', uploadId }
                });
              }
            } catch {
              stopLoadingToast(bgId);
              await typeOutAI(`【設計說明】\n- 复核暂时失败，但效果图已生成；你可直接点下面再生成优化。`, {
                options: refineOptions,
                meta: { kind: 'generated', uploadId }
              });
            }
          } finally {
            stopLoadingToast(genLoadingId);
          }
      } catch (e: any) {
          addSystemToast(`生成失敗：${e.message}`);
          setAppState('ANALYSIS_DONE'); // Revert state
      }
  };

  const handleOptionClick = async (message: Message, opt: string) => {
      const uploadId = message.meta?.uploadId;
      const u = uploadId ? uploads[uploadId] : undefined;

      // One-tap refinement actions (mobile friendly)
      if (opt.startsWith('再精修：')) {
          const tweak = opt.replace('再精修：', '').trim();
          setAppState('GENERATING');
          // Regenerate via t2i with modification note.
          triggerGeneration(null, tweak);
          return;
      }

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

          // Start clickable intake flow in chat (designer-first workflow: layout -> storage/cabinet -> style -> palette -> lighting -> soft)
          const space = u.spaceType || '';
          // Skip extra intake questions for now: go straight to hall type (if living-dining) or layout.
          if (isLivingDiningSpace(space)) {
              await typeOutAI("客餐厅再确认一下（更贴合香港常见户型）：你屋企偏边种厅？", {
                  options: ["标准厅（推荐）", "钻石厅", "长厅", "不确定"],
                  meta: { kind: 'render_flow', stage: 'hall', uploadId }
              });
              return;
          }

          const layouts = (u.layoutOptions && u.layoutOptions.length)
            ? u.layoutOptions.slice(0, 3)
            : pickLayoutOptionsHK(space, (u.render as any)?.hallType);
          await typeOutAI("好，先定「布置/动线」（最影响落地同出图准确）。\n你想用邊個摆位？", {
              options: layouts,
              meta: { kind: 'render_flow', stage: 'layout', uploadId }
          });
          return;
      }

      // Render flow steps (bound to the analysis/upload)
      if (message.meta?.kind === 'render_flow' && uploadId && u) {
          if (message.meta.stage === 'hall') {
              const hallType =
                  opt.includes('钻石') ? '钻石厅'
                  : opt.includes('长') ? '长厅'
                  : opt.includes('标准') ? '标准厅'
                  : '不确定';
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), hallType: hallType as any } }
              }) : prev);

              const space = u.spaceType || '';
              const layouts = (u.layoutOptions && u.layoutOptions.length)
                ? u.layoutOptions.slice(0, 3)
                : pickLayoutOptionsHK(space, hallType);
              await typeOutAI("好，先定「布置/动线」（最影响落地同出图准确）。\n你想用邊個摆位？", {
                  options: layouts,
                  meta: { kind: 'render_flow', stage: 'layout', uploadId }
              });
              return;
          }

          // 1) Layout first (stores into focus). Bed type is part of layout; infer it if mentioned.
          if (message.meta.stage === 'layout') {
              const inferredBed = inferBedTypeFromLayout(opt);
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: {
                      ...prev[uploadId],
                      render: {
                          ...(prev[uploadId].render || {}),
                          focus: opt,
                          ...(inferredBed ? { bedType: inferredBed } : {})
                      }
                  }
              }) : prev);

              // NEW: Right after layout, ask HK-friendly style+tone (keeps prompt alignment and improves output accuracy).
              await typeOutAI("好，布置/动线已定。下一步揀「风格色调」（会直接影响出图质感）：", {
                options: getStyleToneOptionsHK(),
                meta: { kind: 'render_flow', stage: 'style_tone', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'style_tone') {
              const { style, color } = parseStyleTone(opt);
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), ...(style ? { style } : {}), ...(color ? { color } : {}) } }
              }) : prev);

              const space = u.spaceType || '';
              // Offer a fast path: generate with HK defaults, or continue fine-tuning.
              const r0 = (u.render as any) || {};
              const style0 = style || r0.style || getDefaultStyleForHK();
              const color0 = color || r0.color || getDefaultColorForHK(style0);
              const storage0 = r0.storage || getDefaultStorageForSpace(space);
              const vibe0 = r0.vibe || getDefaultVibeForHK();
              const decor0 = r0.decor || getDefaultDecorForHK();
              const intensity0 = r0.intensity || getDefaultIntensityForHK();
              const hall0 = r0.hallType || '不确定';

              await typeOutAI(
                `收到～我建議先用「香港推薦預設」直接出圖（更快、更像提案效果圖）：\n${isLivingDiningSpace(space) ? `- 厅型：${hall0}\n` : ''}- 收纳：${storage0}｜风格：${style0}｜色板：${color0}\n- 灯光：${vibe0}｜软装：${decor0}｜强度：${intensity0}\n要唔要直接生成？`,
                { options: ["直接生成（推薦）"], meta: { kind: 'render_flow', stage: 'fast_confirm', uploadId } }
              );
              return;
          }

          if (message.meta.stage === 'fast_confirm') {
              if (opt === "直接生成（推薦）") {
                  const space = u.spaceType || '';
                  const r0 = (u.render as any) || {};
                  const style0 = r0.style || getDefaultStyleForHK();
                  const color0 = r0.color || getDefaultColorForHK(style0);
                  const storage0 = r0.storage || getDefaultStorageForSpace(space);
                  const vibe0 = r0.vibe || getDefaultVibeForHK();
                  const decor0 = r0.decor || getDefaultDecorForHK();
                  const intensity0 = r0.intensity || getDefaultIntensityForHK();
                  const hall0 = r0.hallType || '不确定';

                  setUploads(prev => prev[uploadId] ? ({
                      ...prev,
                      [uploadId]: {
                          ...prev[uploadId],
                          render: {
                              ...(prev[uploadId].render || {}),
                              style: style0,
                              color: color0,
                              storage: storage0,
                              vibe: vibe0,
                              decor: decor0,
                              intensity: intensity0,
                              hallType: hall0
                          }
                      }
                  }) : prev);

                  // UX: "direct generate" should start immediately (avoid duplicated "start" button).
                  // Build a compact intake and run a single t2i generation as the final render.
                  const focus = (u.render as any)?.focus || '布置方案（按你选择）';
                  const bedType = (u.render as any)?.bedType || '';
                  const intake = {
                      space,
                      style: style0,
                      color: color0,
                      focus,
                      bedType,
                      storage: storage0,
                      vibe: vibe0,
                      decor: decor0,
                      intensity: intensity0,
                      hallType: hall0,
                      // For t2i, we keep vision summary only as structure cues (approximate)
                      visionSummary: u.visionSummary,
                      uploadId,
                      baseWidth: u.width,
                      baseHeight: u.height
                  };

                  setAppState('GENERATING');
                  await triggerGeneration(intake);
                  return;
              }

              // Fine-tuning entry removed for now (post-generation refinements are handled after first render).
              await typeOutAI("收到～我先按推薦預設直接出圖，你之後可以基於第一張效果圖再精修。");
              return;
          }

          // Backward compatibility: if old stage 'focus' is clicked from history, treat it as layout.
          if (message.meta.stage === 'focus') {
              const inferredBed = inferBedTypeFromLayout(opt);
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), focus: opt, ...(inferredBed ? { bedType: inferredBed } : {}) } }
              }) : prev);
              await typeOutAI("收纳取向你想偏边种？（会影响柜体比例与细节）", {
                  options: ["隐藏收纳为主", "收纳+局部展示（少量）", "收纳+书桌/工作位（如需要）"],
                  meta: { kind: 'render_flow', stage: 'storage', uploadId }
              });
              return;
          }

          // 2) Storage/cabinet direction
          if (message.meta.stage === 'storage') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), storage: opt } }
              }) : prev);
              await typeOutAI("风格想走边种？（会决定线条语言与材质）", {
                  options: ["現代簡約", "奶油風", "日式木系", "輕奢"],
                  meta: { kind: 'render_flow', stage: 'style', uploadId }
              });
              return;
          }

          // 3) Style -> palette (color board depends on style)
          if (message.meta.stage === 'style') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), style: opt } }
              }) : prev);
              await typeOutAI("色系/色板想走边套？（会跟风格联动）", {
                  options: getPaletteOptionsForStyle(opt),
                  meta: { kind: 'render_flow', stage: 'color', uploadId }
              });
              return;
          }

          // 4) Palette -> lighting vibe
          if (message.meta.stage === 'color') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), color: opt } }
              }) : prev);
              await typeOutAI("想要咩燈光氛圍？（會直接影響效果圖質感）", {
                  options: ["明亮通透", "溫馨暖光", "高級氛圍（酒店感）"],
                  meta: { kind: 'render_flow', stage: 'vibe', uploadId }
              });
              return;
          }

          // 5) Lighting vibe -> soft furnishing density
          if (message.meta.stage === 'vibe') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), vibe: opt } }
              }) : prev);
              await typeOutAI("软装丰富度想要几多？（越丰富越有气氛，但也更容易显乱）", {
                  options: ["克制簡潔（更清爽）", "標準搭配（推薦）", "豐富氛圍（更有層次）"],
                  meta: { kind: 'render_flow', stage: 'decor', uploadId }
              });
              return;
          }

          // 6) Soft -> confirm
          if (message.meta.stage === 'decor') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), decor: opt } }
              }) : prev);

              const r = (u.render as any) || {};
              const style = r.style || '現代簡約';
              const color = r.color || '淺木+米白';
              const layout = r.focus || '布置方案（按你选择）';
              const storage = r.storage || '隐藏收纳为主';
              const vibe = r.vibe || '溫馨暖光';
              const decor = r.decor || opt;
              await typeOutAI(
                `好，我幫你用「布置：${layout}｜收纳：${storage}｜风格：${style}｜色板：${color}｜灯光：${vibe}｜软装：${decor}」出一张效果图。\n准备好就按下面开始生成～`,
                { options: ["開始生成效果圖"], meta: { kind: 'render_flow', stage: 'confirm', uploadId } }
              );
              return;
          }

          // Backward compatibility: old 'bed' stage just maps into storage step
          if (message.meta.stage === 'bed') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), bedType: opt } }
              }) : prev);
              await typeOutAI("收纳取向你想偏边种？（会影响柜体比例与细节）", {
                  options: ["隐藏收纳为主", "收纳+局部展示（少量）", "收纳+书桌/工作位（如需要）"],
                  meta: { kind: 'render_flow', stage: 'storage', uploadId }
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
              await typeOutAI(`好，我幫你用「${style}｜${color}｜${focus}｜${storage}」出一張效果圖。準備好就按下面開始生成～`, {
                  options: ["開始生成效果圖"],
                  meta: { kind: 'render_flow', stage: 'confirm', uploadId }
              });
              return;
          }

          // Note: i2i flow is disabled for the current t2i-only test phase.
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
