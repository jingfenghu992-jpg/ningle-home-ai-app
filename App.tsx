import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from './components/AppShell';
import { AppBar } from './components/AppBar';
import { StartScreen } from './components/StartScreen';
import { MessageCard } from './components/MessageCard';
import { Composer } from './components/Composer';
import { Message } from './types';
import { analyzeImage, analyzeImageFast } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateDesignImage, generateInspireImage, generateRenderImage, uploadImage } from './services/generateClient';
import { compressImage } from './services/utils';
import { classifySpace } from './services/spaceClient';

const App: React.FC = () => {
  // --- State ---
  const [appState, setAppState] = useState<'START' | 'WAITING_FOR_SPACE' | 'ANALYZING' | 'ANALYSIS_DONE' | 'RENDER_INTAKE' | 'GENERATING' | 'RENDER_DONE'>('START');
  const [clientId, setClientId] = useState<string>(''); // per-device user id
  const debugEnabled = (() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      return false;
    }
  })();
  
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
    generatedImageUrl?: string; // last generated result (temporary URL or data URL)
    render?: {
      style?: string;
      color?: string;
      focus?: string;
      roomWidthChi?: string;   // e.g. "8–10尺"
      roomHeightChi?: string;  // e.g. "7尺2–7尺8"
      targetUse?: string; // 当空间类型=其他时，用于锁定文生图的目标用途（客厅/卧室等）
      storage?: string;
      priority?: string;
      intensity?: string;
      hallType?: '标准厅' | '钻石厅' | '长厅' | '不确定';
    };
  }>>({});
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(null);
  // Keep the last used render intake so "再精修" can reuse the same selections.
  const lastRenderIntakeRef = useRef<any>(null);
  const lastGuardrailRef = useRef<any>(null);
  
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

  const upsertOptionsCard = (id: string, text: string, options: string[], meta: Message['meta']) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      const nextMsg: Message = {
        id,
        type: 'text',
        content: text,
        sender: 'ai',
        timestamp: Date.now(),
        options,
        meta,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...nextMsg };
        return next;
      }
      return [...prev, nextMsg];
    });
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
      await typeOutAI("找不到对应的图片，麻烦你再上传一次～");
      setAppState('START');
      return;
    }
    // Prevent duplicate analysis for the same uploadId
    if (active.analysisStatus === 'running') {
      await typeOutAI("收到～我而家分析緊呢張相，你等我幾秒先～");
      return;
    }
    if (active.analysisStatus === 'done' && String(active.spaceType || '') === String(spaceTypeText || '')) {
      await typeOutAI("这张图片我已经分析完成啦～你可以直接点「生成智能效果图」。");
      return;
    }

    const analysisLoadingId = addLoadingToast("收到，图片正在分析中，请稍等…", { loadingType: 'analyzing', uploadId });
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
          { options: ["生成智能效果图"], meta: { kind: 'analysis', uploadId } }
        );
      } else {
        stopLoadingToast(analysisLoadingId);
        setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], analysisStatus: 'idle' } }) : prev);
        if (visionRes?.errorCode === 'IMAGE_URL_UNREACHABLE') {
          await typeOutAI("图片链接访问失败（可能过期/无权限）。请重新上传同一张图片再试一次。");
        } else {
          await typeOutAI("分析失败，请重试。");
        }
        setAppState('WAITING_FOR_SPACE');
      }
    } catch (e) {
      console.error(e);
      stopLoadingToast(analysisLoadingId);
      setUploads(prev => prev[uploadId] ? ({ ...prev, [uploadId]: { ...prev[uploadId], analysisStatus: 'idle' } }) : prev);
      // If backend reports image URL unreachable, user must re-upload to refresh the URL.
      const msg = String((e as any)?.message || '');
      if (msg.includes('IMAGE_URL_UNREACHABLE')) {
        await typeOutAI("图片链接访问失败（可能过期/无权限）。请重新上传同一张图片再试一次。");
      } else {
        await typeOutAI("系统错误，请重试。");
      }
      setAppState('WAITING_FOR_SPACE');
    }
  };

  // HK V2: fast first render (no vision dependency).
  const getQuickRenderPicks = (u: any) => {
    const r = (u?.render || {}) as any;
    return {
      style: String(r.style || '现代简约'),
      goal: String(r.priority || '收纳优先'),
      intensity: String(r.intensity || '保守（更对位）'),
    };
  };

  const getQuickRenderOptions = (u: any, includeVision: boolean) => {
    const picks = getQuickRenderPicks(u);
    const styles = ['现代简约', '奶油风', '日式木系', '轻奢'];
    const goals = ['收纳优先', '氛围舒适', '显大清爽'];
    const intensities = ['保守（更对位）', '明显（更有设计感）'];
    const withRadio = (group: string, label: string, picked: string) =>
      (picked === label ? `${group}：◉ ${label}` : `${group}：○ ${label}`);

    const opts = [
      ...styles.map(s => withRadio('风格', s, picks.style)),
      ...goals.map(g => withRadio('目标', g, picks.goal)),
      ...intensities.map(i => withRadio('强度', i, picks.intensity)),
      '一键出图（推荐）',
      '概念示意（较快，不保证对位）',
      ...(includeVision ? ['更似我间屋（精准校准，需要分析）'] : []),
    ];
    const uniq: string[] = [];
    for (const o of opts) {
      const t = String(o || '').trim();
      if (!t) continue;
      if (!uniq.includes(t)) uniq.push(t);
      if (uniq.length >= 14) break;
    }
    return uniq;
  };

  const quickI2IOverridesByIntensity = (label: string) => {
    const t = String(label || '');
    if (t.includes('明显') || t.includes('明顯')) {
      return { i2i_strength: 0.32, i2i_source_weight: 0.95, cfg_scale: 5.0, steps: 24 };
    }
    return { i2i_strength: 0.22, i2i_source_weight: 0.98, cfg_scale: 5.0, steps: 22 };
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
                      const classifyId = addLoadingToast("我先帮你判断这张图是什么空间，请稍等…", { loadingType: 'classifying', uploadId });
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

                        upsertOptionsCard(
                          `${uploadId}-space_pick`,
                          `我猜你这张图是「${primary}」\n你点一下确认就行（不对也可以改）`,
                          options,
                          { kind: 'space_pick', uploadId }
                        );
                      } catch (err) {
                        stopLoadingToast(classifyId);
                        addSystemToast("收到～想确认一下：这张图是哪个空间？（例如：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他）");
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
                    addSystemToast("收到～想确认一下：这张图是哪个空间？（例如：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他）");
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
                addSystemToast("收到～想确认一下：这张图是哪个空间？（例如：客餐厅/大睡房/小睡房/厨房/卫生间/入户/走廊/其他）");
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
          addSystemToast("找不到你最新上传的图片，麻烦你再上传一次～");
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
  const getDefaultDecorForHK = () => "标准搭配（推荐）";
  // 文生图会更“有设计感”；结构约束依赖 visionExtraction + 动线/尺寸文字约束来贴近原图。
  const getDefaultIntensityForHK = () => "明显改造（推荐）";
  const getDefaultStorageForSpace = (space?: string) => {
      const s = normalizeSpaceKey(space);
      if (s.includes('厨房') || s.includes('廚') || s.includes('厨')) return "台面整洁收纳（隐藏小家电）";
      if (s.includes('卫') || s.includes('衛') || s.includes('卫生间') || s.includes('洗手') || s.includes('厕') || s.includes('廁')) return "镜柜+壁龛（更好用）";
      return "隐藏收纳为主";
  };

  // HK-friendly size presets (in 尺). We offer two widths + two heights => 4 combined options.
  const getDimensionOptionsHK = (space?: string) => {
      const s = normalizeSpaceKey(space);
      const isLivingDining = s.includes('客餐');
      const isKitchen = s.includes('厨房') || s.includes('廚') || s.includes('厨');
      const isEntrance = s.includes('入户') || s.includes('玄') || s.includes('關') || s.includes('关');
      const isCorridor = s.includes('走廊') || s.includes('通道');
      const isBathroom = s.includes('卫') || s.includes('衛') || s.includes('卫生间') || s.includes('洗手') || s.includes('厕') || s.includes('廁');
      const isMasterBed = s.includes('大睡房') || s.includes('主人房') || s.includes('主卧');
      const isSmallBed = s.includes('小睡房') || s.includes('次卧') || s.includes('儿童房') || s.includes('眼镜房');

      // Width presets (香港常见净宽区间，按空间智能给两档)
      const widthA =
        isLivingDining ? '10–12尺'
        : isMasterBed ? '9–11尺'
        : isSmallBed ? '7–8尺'
        : isKitchen ? '5–6尺'
        : isBathroom ? '4–5尺'
        : (isEntrance || isCorridor) ? '3–4尺'
        : '8–10尺';
      const widthB =
        isLivingDining ? '12–14尺'
        : isMasterBed ? '11–13尺'
        : isSmallBed ? '8–9尺'
        : isKitchen ? '6–7尺'
        : isBathroom ? '5–6尺'
        : (isEntrance || isCorridor) ? '4–5尺'
        : '10–12尺';

      // Ceiling height presets (香港常见 2.2–2.4m 左右，换算成尺约 7尺2–7尺9)
      const hA = '7尺2–7尺8';
      const hB = '8尺0–8尺6';

      return [
        `宽 ${widthA}｜高 ${hA}`,
        `宽 ${widthA}｜高 ${hB}`,
        `宽 ${widthB}｜高 ${hA}`,
        `宽 ${widthB}｜高 ${hB}`,
      ];
  };

  const parseDimsChi = (opt: string) => {
      const t = String(opt || '').trim();
      const mW = t.match(/宽\s*([^｜|]+)\s*[｜|]/);
      const mH = t.match(/高\s*([0-9尺.\-–—]+(?:\s*[–—-]\s*[0-9尺.\-–—]+)?)$/);
      const roomWidthChi = mW?.[1]?.trim() || '';
      const roomHeightChi = mH?.[1]?.trim() || '';
      return { roomWidthChi, roomHeightChi };
  };

  const isLivingDiningSpace = (space?: string) => {
      const s = normalizeSpaceKey(space);
      return s.includes('客餐') || s === '客餐厅' || (s.includes('客') && s.includes('餐'));
  };

  const pickLayoutOptionsHK = (space?: string, hallType?: string) => {
      const options = getLayoutOptionsForSpace(space);
      const h = String(hallType || '').trim();
      if (!options.length) return options;
      if (!h || h.includes('不确定') || h.includes('标准')) return options.slice(0, 2);

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
      // If scoring didn't help, fall back to first 2
      const top = ranked.slice(0, 2);
      return top.every(x => score(x) === 0) ? options.slice(0, 2) : top;
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

  const triggerGeneration = async (intakeData: any, revisionText?: string, overrides?: any) => {
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

          // FINAL render：使用文生图（/api/design/inspire），但通过 visionExtraction + 动线/尺寸指令尽量贴近原图结构（目标 80%+）
          const genLoadingId = addLoadingToast("收到～我现在帮你生成效果图，请稍等…", { loadingType: 'generating', uploadId });
          try {
            const u = uploadId ? uploads[uploadId] : undefined;
            const sourceImageUrl = u?.imageUrl;
            const preferPrecise = (u?.render as any)?.preferPrecise;
            const outputMode = sourceImageUrl && preferPrecise !== false ? 'PRECISE_I2I' : 'FAST_T2I';
            const keep_structure = outputMode === 'PRECISE_I2I';
            const qualityPreset = outputMode === 'PRECISE_I2I' ? 'STRUCTURE_LOCK' : undefined;
            const payload: any = {
              renderIntake,
              sourceImageUrl,
              outputMode,
              keep_structure,
              qualityPreset,
              layoutVariant: (u?.render as any)?.layoutVariant,
              sizeChoice: (u?.render as any)?.sizeChoice,
              styleChoice: (u?.render as any)?.styleChoice,
              response_format: 'url',
              // 速度优先：默认稍低 steps；同时保持一定 cfg 让“有设计感”
              steps: 24,
              cfg_scale: 6.6,
              size,
              debug: debugEnabled,
              ...(overrides || {}),
            };
            const res = await generateInspireImage(payload);
            stopLoadingToast(genLoadingId);

            if (!res.ok || !res.resultUrl) {
              const code = (res as any)?.errorCode;
              const msg = (res as any)?.message || '生成失败';
              if (code === 'BASE_IMAGE_REQUIRED') {
                await typeOutAI("相片链接无法读取（更贴原相需要相片可访问）。请重新上传同一张图片再试一次。");
                setAppState('ANALYSIS_DONE');
                return;
              }
              if (code === 'IMAGE_URL_UNREACHABLE') {
                await typeOutAI("图片链接访问失败（可能过期/无权限）。请重新上传同一张图片再试一次。");
                setAppState('ANALYSIS_DONE');
                return;
              }
              if (code === 'DISTORTION_SUSPECTED') {
                const plan = (res as any)?.fallbackPlan;
                lastGuardrailRef.current = { uploadId, renderIntake, sourceImageUrl, plan };
                await typeOutAI(
                  "我检测到这次出图可能有广角/鱼眼/黑角/拉伸变形，为避免误导我先不出图。\n你要点哪个方案继续？",
                  {
                    options: ["再试：更保守（推荐）", "改用概念图（较快）"],
                    meta: { kind: 'guardrail', stage: 'distortion', uploadId }
                  }
                );
                setAppState('ANALYSIS_DONE');
                return;
              }
              if (typeof code === 'string' && code.startsWith('UPSTREAM_I2I_')) {
                await typeOutAI("精准模式暂时失败（我未有偷偷改用概念图，避免不对位）。你可以稍后再试一次，或者点「概念示意（较快，不保证对位）」。");
                setAppState('ANALYSIS_DONE');
                return;
              }
              throw new Error(msg);
            }

            const resultUrl = res.resultUrl;
            if (debugEnabled && (res as any)?.debug?.usedText) {
              const d: any = (res as any).debug || {};
              const i2i = d.i2iParams ? ` i2i(str=${d.i2iParams.strength}, sw=${d.i2iParams.source_weight}, cfg=${d.i2iParams.cfg_scale}, st=${d.i2iParams.steps})` : '';
              const base = (d.baseImageBytes || d.baseImageWidth || d.baseImageHeight)
                ? ` base=${d.baseImageWidth ?? ''}x${d.baseImageHeight ?? ''} bytes=${d.baseImageBytes ?? ''}`
                : '';
              const ar = d.aspectRatio ? ` ar=${Number(d.aspectRatio).toFixed(3)}` : '';
              const sizeInfo = d.targetSize ? ` target=${d.targetSize}` : (d.sentSize ? ` target=${d.sentSize}` : '');
              const pad = (typeof d.padded === 'boolean') ? ` padded=${d.padded}` : '';
              const fetchOk = (typeof d.imageFetchOk === 'boolean') ? ` fetchOk=${d.imageFetchOk}` : '';
              const lite = d.hkAnchorsLite
                ? ` lite(win=${d.hkAnchorsLite.window_wall ?? ''}/${d.hkAnchorsLite.window_count ?? ''}, lens=${d.hkAnchorsLite.lens_risk ?? ''})`
                : '';
              const header =
                `endpoint=${d.usedEndpoint ?? d.requestedEndpoint ?? ''} | mode=${d.outputMode ?? ''} | fallback=${d.fallbackUsed ?? ''} | mismatch=${d.mismatch ?? ''} | chars=${d.promptChars ?? ''} | hash=${d.promptHash ?? ''} | hkSpace=${d.hkSpace ?? ''} | A/B=${d.layoutVariant ?? ''} | dropped=${(d.dropped || []).join(',')}` +
                `${fetchOk}${i2i}${base}${ar}${sizeInfo}${pad}${lite}`;
              const usedText = String(d.usedText || '').trim();
              if (usedText) {
                console.log('[DEBUG] inspire usedText', usedText);
                setMessages(prev => [
                  ...prev,
                  { id: `${Date.now()}-debug-prompt`, type: 'text', content: `[[DEBUG_PROMPT]]\n${header}\n\n${usedText}`, sender: 'ai', timestamp: Date.now() }
                ]);
              }
              if (d.fallbackUsed) {
                await typeOutAI("提示：精准模式暂时失败，已改用快速概念图（可能不对位）。");
              }
            }
            setLastGeneratedImage(resultUrl);
            if (uploadId) {
              setUploads(prev => prev[uploadId] ? ({
                ...prev,
                [uploadId]: { ...prev[uploadId], generatedImageUrl: resultUrl }
              }) : prev);
            }
            setAppState('RENDER_DONE');
            setMessages(prev => [
              ...prev,
              { id: `${Date.now()}-img`, type: 'image', content: resultUrl, sender: 'ai', timestamp: Date.now() }
            ]);

            // Notes must be consistent with the generated image (same renderId).
            const renderId = (res as any)?.renderId;
            const notes = String((res as any)?.designNotes || '').trim();
            const refineOptions = ["更似我间屋（保留窗位/透视）", "收纳更强（加到顶柜/地台）", "氛围更靓（灯光+软装）"];
            if (notes) {
              await typeOutAI(
                `【设计说明（与本次效果图一致）】${renderId ? `\nrenderId: ${renderId}` : ''}\n${notes}\n\n想再改一张？点下面一个：`,
                { options: refineOptions, meta: { kind: 'generated', uploadId } }
              );
            } else {
              await typeOutAI(
                `效果图已出。${renderId ? `\nrenderId: ${renderId}` : ''}\n想再改一张？点下面一个：`,
                { options: refineOptions, meta: { kind: 'generated', uploadId } }
              );
            }
          } finally {
            stopLoadingToast(genLoadingId);
          }
      } catch (e: any) {
          addSystemToast(`生成失敗：${e.message}`);
          setAppState('ANALYSIS_DONE'); // Revert state
      }
  };

  // Detail enhancement using the current effect image as reference (slower but aligns better).
  const triggerEnhanceFromCurrent = async (baseImageUrl: string, tweak: string, uploadId?: string) => {
      try {
          const base = lastRenderIntakeRef.current || {};
          const size = (() => {
              const u = uploadId ? uploads[uploadId] : undefined;
              // Prefer keeping the orientation consistent with the user's original photo.
              const w = u?.width || base?.baseWidth;
              const h = u?.height || base?.baseHeight;
              if (!w || !h) return '1280x800';
              return h > w ? '800x1280' : '1280x800';
          })();

          const renderIntake = ({
              ...(base || {}),
              requirements: `${String(base?.requirements || '').trim()}\n\n精修重点：${tweak}`.trim()
          });
          lastRenderIntakeRef.current = renderIntake;

          const genLoadingId = addLoadingToast("收到～我现在帮你做细节增强（会比第一次慢一点），请稍等…", { loadingType: 'generating', uploadId });
          try {
              const res = await generateDesignImage({
                  baseImageBlobUrl: baseImageUrl,
                  size,
                  renderIntake,
                  response_format: 'url',
                  // Keep structure/layout from the current effect image; focus on detailing
                  source_weight: 0.45,
                  steps: 38,
                  cfg_scale: 7.2,
                  fast_refine: true,
                  debug: debugEnabled,
              });

              stopLoadingToast(genLoadingId);
              if (!res.ok || !res.resultBlobUrl) {
                  if (res.errorCode === 'RATE_LIMITED') {
                      await typeOutAI("而家生成排队中（同一时间只能处理一单），建议等 30–60 秒再点一次精修～");
                      setAppState('ANALYSIS_DONE');
                      return;
                  }
                  if (res.errorCode === 'TIMEOUT') {
                      await typeOutAI("精修超时了（服务器繁忙时会出现）。你可以稍后再点一次「再精修：柜体更清晰」。");
                      setAppState('ANALYSIS_DONE');
                      return;
                  }
                  throw new Error(res.message || '细节增强失败');
              }

              const resultUrl = res.resultBlobUrl;
              if (debugEnabled && (res as any)?.debug?.usedText) {
                const d: any = (res as any).debug || {};
                const header = `Prompt chars: ${d.promptChars ?? ''} | hash: ${d.promptHash ?? ''}`;
                const usedText = String(d.usedText || '').trim();
                if (usedText) {
                  console.log('[DEBUG] generate usedText', usedText);
                  setMessages(prev => [
                    ...prev,
                    { id: `${Date.now()}-debug-prompt`, type: 'text', content: `[[DEBUG_PROMPT]]\n${header}\n\n${usedText}`, sender: 'ai', timestamp: Date.now() }
                  ]);
                }
              }
              setLastGeneratedImage(resultUrl);
              if (uploadId) {
                setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], generatedImageUrl: resultUrl }
                }) : prev);
              }
              setAppState('RENDER_DONE');
              setMessages(prev => [
                ...prev,
                { id: `${Date.now()}-img`, type: 'image', content: resultUrl, sender: 'ai', timestamp: Date.now() }
              ]);

              const refineOptions = ["更似我间屋（保留窗位/透视）", "收纳更强（加到顶柜/地台）", "氛围更靓（灯光+软装）"];
              await typeOutAI("细节已增强，想再改一张？点下面一个：", {
                options: refineOptions,
                meta: { kind: 'generated', uploadId }
              });
          } finally {
              stopLoadingToast(genLoadingId);
          }
      } catch (e: any) {
          addSystemToast(`细节增强失敗：${e.message}`);
          setAppState('ANALYSIS_DONE');
      }
  };

  const handleOptionClick = async (message: Message, opt: string) => {
      const uploadId = message.meta?.uploadId;
      const u = uploadId ? uploads[uploadId] : undefined;

      if (message.meta?.kind === 'guardrail' && message.meta?.stage === 'distortion') {
          const ctx = lastGuardrailRef.current || {};
          const ru = ctx?.renderIntake || lastRenderIntakeRef.current || {};
          const upId = ctx?.uploadId || uploadId || ru?.uploadId;
          const sourceUrl = ctx?.sourceImageUrl || (upId ? uploads[upId]?.imageUrl : undefined);
          setAppState('GENERATING');
          if (opt.startsWith('再试')) {
              await triggerGeneration(ru, undefined, {
                  sourceImageUrl: sourceUrl,
                  outputMode: 'PRECISE_I2I',
                  keep_structure: true,
                  qualityPreset: 'STRUCTURE_LOCK',
                  i2i_source_weight: 0.97,
                  i2i_strength: 0.25,
                  cfg_scale: 4.2,
              });
              return;
          }
          if (opt.startsWith('改用概念图')) {
              await triggerGeneration(ru, undefined, {
                  outputMode: 'FAST_T2I',
              });
              return;
          }
      }

      // One-tap refinement actions (mobile friendly)
      if (opt.startsWith('再精修：')) {
          // Prevent spamming (StepFun often enforces very low concurrency)
          if (message.isLocked || appState === 'GENERATING') {
              await typeOutAI("收到～我现在精修中，通常要 1–3 分钟；完成后我会出新效果图。");
              return;
          }
          // Lock this message so the user won't accidentally queue multiple jobs
          setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isLocked: true } : m));

          const tweak = opt.replace('再精修：', '').trim();
          setAppState('GENERATING');
          // Prefer detail enhancement using the current generated image as reference.
          const baseImg = (uploadId && uploads[uploadId]?.generatedImageUrl) ? uploads[uploadId]!.generatedImageUrl! : (lastGeneratedImage || '');
          if (baseImg) {
            triggerEnhanceFromCurrent(baseImg, tweak, uploadId);
          } else {
            // Fallback: regenerate from text only
            triggerGeneration(null, tweak);
          }
          return;
      }

      // HK V2 post-render refine buttons (rerun i2i from the original upload)
      if (opt === '更似我间屋（保留窗位/透视）' || opt === '收纳更强（加到顶柜/地台）' || opt === '氛围更靓（灯光+软装）') {
          if (message.isLocked || appState === 'GENERATING') {
              await typeOutAI("收到～我而家生成緊，你等我出完先再点下一张～");
              return;
          }
          setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isLocked: true } : m));

          const u0 = uploadId ? uploads[uploadId] : undefined;
          const base0 = (lastRenderIntakeRef.current && typeof lastRenderIntakeRef.current === 'object')
            ? { ...lastRenderIntakeRef.current }
            : {};
          const intensity =
            opt.includes('更似') ? '保守（更对位）'
              : (base0?.intensity || (u0?.render as any)?.intensity || '保守（更对位）');
          const goal =
            opt.includes('收纳') ? '收纳优先'
              : opt.includes('氛围') ? '氛围舒适'
                : (base0?.priority || (u0?.render as any)?.priority || '收纳优先');

          const nextBase = {
            ...(base0 || {}),
            uploadId,
            baseWidth: u0?.width || base0?.baseWidth,
            baseHeight: u0?.height || base0?.baseHeight,
            space: u0?.spaceType || base0?.space || '',
            priority: goal,
            intensity,
            // add a tiny note (keeps prompts short; structure is locked in hkPrompt)
            requirements: opt.includes('更似')
              ? `${String(base0?.requirements || '').trim()}\nKeep materials/lighting closer to the photo; keep openings unchanged.`.trim()
              : String(base0?.requirements || '').trim()
          };

          // Persist pick in upload state
          if (uploadId) {
            setUploads(prev => prev[uploadId] ? ({
              ...prev,
              [uploadId]: {
                ...prev[uploadId],
                render: {
                  ...(prev[uploadId].render || {}),
                  priority: goal,
                  intensity,
                  ...(prev[uploadId].imageUrl ? { preferPrecise: true } : {})
                }
              }
            }) : prev);
          }

          await triggerGeneration(nextBase, undefined, {
            outputMode: 'PRECISE_I2I',
            keep_structure: true,
            qualityPreset: 'STRUCTURE_LOCK',
            fastAnchors: true,
            ...quickI2IOverridesByIntensity(intensity),
          });
          return;
      }

      if (message.meta?.kind === 'space_pick' && uploadId) {
          // Lock this message to prevent double-trigger
          if (message.isLocked) return;
          setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isLocked: true } : m));
          // HK V2 fast path: don't block first render on vision analysis.
          setUploads(prev => prev[uploadId] ? ({
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              spaceType: opt,
              render: {
                ...(prev[uploadId].render || {}),
                style: (prev[uploadId].render as any)?.style || '现代简约',
                priority: (prev[uploadId].render as any)?.priority || '收纳优先',
                intensity: (prev[uploadId].render as any)?.intensity || '保守（更对位）',
                ...(prev[uploadId].imageUrl ? { preferPrecise: true } : {})
              }
            }
          }) : prev);

          const u2 = uploads[uploadId] || {};
          const cardId = `${uploadId}-quick_render-picks`;
          upsertOptionsCard(
            cardId,
            `收到～我先按香港常见比例帮你快出第一张（更对位、少问）。\n你可以直接点「一键出图（推荐）」，或先改风格/目标/强度：`,
            getQuickRenderOptions(u2, debugEnabled),
            { kind: 'quick_render', stage: 'picks', uploadId }
          );
          return;
      }

      if (message.meta?.kind === 'quick_render' && uploadId) {
        const u0 = uploads[uploadId];
        if (!u0) return;

        const cleaned = String(opt || '')
          .replace(/^(风格|目标|强度)：\s*[◉○]\s*/g, '')
          .replace(/^[☑☐◉○]\s+/g, '')
          .trim();
        const isStyle = ['现代简约', '奶油风', '日式木系', '轻奢'].includes(cleaned);
        const isGoal = ['收纳优先', '氛围舒适', '显大清爽'].includes(cleaned);
        const isIntensity = ['保守（更对位）', '明显（更有设计感）'].includes(cleaned);

        if (cleaned === '更似我间屋（精准校准，需要分析）') {
          await runAnalysisForUpload(uploadId, u0.spaceType || '其他');
          return;
        }

        if (cleaned === '概念示意（较快，不保证对位）') {
          const picks = getQuickRenderPicks(u0);
          const base = {
            uploadId,
            baseWidth: u0.width,
            baseHeight: u0.height,
            space: u0.spaceType || '',
            style: picks.style,
            priority: picks.goal,
            intensity: picks.intensity,
          };
          await triggerGeneration(base, undefined, {
            outputMode: 'FAST_T2I',
            sourceImageUrl: null,
            keep_structure: false,
            qualityPreset: undefined,
          });
          return;
        }

        if (cleaned === '一键出图（推荐）') {
          const picks = getQuickRenderPicks(u0);
          const base = {
            uploadId,
            baseWidth: u0.width,
            baseHeight: u0.height,
            space: u0.spaceType || '',
            style: picks.style,
            priority: picks.goal,
            intensity: picks.intensity,
          };
          await triggerGeneration(base, undefined, {
            outputMode: 'PRECISE_I2I',
            keep_structure: true,
            qualityPreset: 'STRUCTURE_LOCK',
            fastAnchors: true,
            ...quickI2IOverridesByIntensity(picks.intensity),
          });
          return;
        }

        if (isStyle || isGoal || isIntensity) {
          const previewU = {
            ...(u0 || {}),
            render: {
              ...(u0?.render || {}),
              ...(isStyle ? { style: cleaned } : {}),
              ...(isGoal ? { priority: cleaned } : {}),
              ...(isIntensity ? { intensity: cleaned } : {}),
            }
          };
          setUploads(prev => prev[uploadId] ? ({
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              render: {
                ...(prev[uploadId].render || {}),
                ...(isStyle ? { style: cleaned } : {}),
                ...(isGoal ? { priority: cleaned } : {}),
                ...(isIntensity ? { intensity: cleaned } : {}),
              }
            }
          }) : prev);

          const picks = getQuickRenderPicks(previewU);
          const cardId = `${uploadId}-quick_render-picks`;
          upsertOptionsCard(
            cardId,
            `已选：风格=${picks.style}｜目标=${picks.goal}｜强度=${picks.intensity}\n点「一键出图（推荐）」就会开始生成。`,
            getQuickRenderOptions(previewU, debugEnabled),
            { kind: 'quick_render', stage: 'picks', uploadId }
          );
          return;
        }
        return;
      }

      if (opt === '生成智能效果图') {
          // Prevent repeated taps from spamming; but don't make it "no response"
          if (message.isLocked) {
              await typeOutAI("收到～我已經開始處理緊，你等我幾秒先～");
              return;
          }

          // If blob URL not ready, guide user to wait to avoid "Missing baseImageBlobUrl"
          if (!uploadId || !u) {
              await typeOutAI("找不到对应的图片，麻烦你再上传一次～");
              return;
          }
          // Lock this message after we confirm we can start the flow
          setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isLocked: true } : m));

          // Prefer public URL; silently fallback to base64 if upload URL isn't ready/failed.

          // Start clickable intake flow in chat (designer-first workflow: layout -> storage/cabinet -> style -> palette -> lighting -> soft)
          const space = u.spaceType || '';
          // Skip extra intake questions for now: go straight to hall type (if living-dining) or layout.
          // 若空间被判为“其他”，先问“目标用途”，否则文生图容易自由发挥（例如日式榻榻米厅）。
          if (String(space).trim() === '其他') {
              await typeOutAI("这个空间你准备做成什么用途？（会直接影响出图像不像原图）", {
                  options: ["客餐厅", "卧室", "书房/多功能房", "玄关/走廊", "保持“其他”"],
                  meta: { kind: 'render_flow', stage: 'target_use', uploadId }
              });
              return;
          }
          if (isLivingDiningSpace(space)) {
              await typeOutAI("客餐厅再确认一下（更贴合香港常见户型）：你家偏哪种厅？", {
                  options: ["标准厅（推荐）", "钻石厅", "长厅", "不确定"],
                  meta: { kind: 'render_flow', stage: 'hall', uploadId }
              });
              return;
          }

          const layouts = (u.layoutOptions && u.layoutOptions.length)
            ? u.layoutOptions.slice(0, 2)
            : pickLayoutOptionsHK(space, (u.render as any)?.hallType);
          await typeOutAI("好，先定「布置/动线」（最影响落地和出图准确）。\n你想用哪个摆位？", {
              options: layouts,
              meta: { kind: 'render_flow', stage: 'layout', uploadId }
          });
          return;
      }

      // Render flow steps (bound to the analysis/upload)
      if (message.meta?.kind === 'render_flow' && uploadId && u) {
          if (message.meta.stage === 'target_use') {
              const chosen =
                opt.includes('客餐') ? '客餐厅'
                : opt.includes('卧室') ? '卧室'
                : opt.includes('书房') ? '书房'
                : opt.includes('玄关') || opt.includes('走廊') ? '玄关/走廊'
                : '其他';
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), targetUse: chosen } }
              }) : prev);

              // 继续走原流程：其他空间不需要厅型，直接到 layout
              const space = u.spaceType || '';
              const layouts = (u.layoutOptions && u.layoutOptions.length)
                ? u.layoutOptions.slice(0, 2)
                : pickLayoutOptionsHK(space, (u.render as any)?.hallType);
              await typeOutAI("好，先定「布置/动线」（最影响落地和出图准确）。\n你想用哪个摆位？", {
                  options: layouts,
                  meta: { kind: 'render_flow', stage: 'layout', uploadId }
              });
              return;
          }
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
                ? u.layoutOptions.slice(0, 2)
                : pickLayoutOptionsHK(space, hallType);
              await typeOutAI("好，先定「布置/动线」（最影响落地和出图准确）。\n你想用哪个摆位？", {
                  options: layouts,
                  meta: { kind: 'render_flow', stage: 'layout', uploadId }
              });
              return;
          }

          // 1) Layout first (stores into focus). Bed type is part of layout; infer it if mentioned.
          if (message.meta.stage === 'layout') {
              const inferredBed = inferBedTypeFromLayout(opt);
              const layoutIdx = Array.isArray(message.options) ? message.options.indexOf(opt) : -1;
              const layoutVariant = layoutIdx === 1 ? 'B' : 'A';
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: {
                      ...prev[uploadId],
                      render: {
                          ...(prev[uploadId].render || {}),
                          focus: opt,
                          layoutVariant,
                          ...(inferredBed ? { bedType: inferredBed } : {})
                      }
                  }
              }) : prev);

              // After layout, confirm approximate room size (HK-friendly in 尺) to improve proportions.
              const space = u.spaceType || '';
              await typeOutAI("好，布置/动线已定。再确认一下「空间大概尺寸」（更贴近香港比例）：", {
                options: getDimensionOptionsHK(space),
                meta: { kind: 'render_flow', stage: 'dimensions', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'dimensions') {
              const { roomWidthChi, roomHeightChi } = parseDimsChi(opt);
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: {
                      ...prev[uploadId],
                      render: {
                          ...(prev[uploadId].render || {}),
                          sizeChoice: opt,
                          ...(roomWidthChi ? { roomWidthChi } : {}),
                          ...(roomHeightChi ? { roomHeightChi } : {}),
                      }
                  }
              }) : prev);

              // Next: style+tone selection (directly affects the final render).
              await typeOutAI("收到～下一步选「风格色调」（会直接影响出图质感）：", {
                options: getStyleToneOptionsHK(),
                meta: { kind: 'render_flow', stage: 'style_tone', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'style_tone') {
              const { style, color } = parseStyleTone(opt);
              const hasSource = Boolean(u?.imageUrl);
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: {
                    ...prev[uploadId],
                    render: {
                      ...(prev[uploadId].render || {}),
                      styleChoice: opt,
                      ...(style ? { style } : {}),
                      ...(color ? { color } : {}),
                      // Default: if we have a public image URL, enable precise mode unless user turned it off.
                      ...(hasSource && typeof (prev[uploadId].render as any)?.preferPrecise !== 'boolean' ? { preferPrecise: true } : {})
                    }
                  }
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

              const preferPrecise = hasSource ? ((u?.render as any)?.preferPrecise ?? true) : false;
              const toggleOpt = preferPrecise ? '☑ 更贴原相（推荐）' : '☐ 更贴原相（更快）';
              const opts = hasSource ? [toggleOpt, "直接生成（推荐）"] : ["直接生成（推荐）"];
              await typeOutAI(
                `收到～我建议先用「香港推荐预设」直接出图：\n${isLivingDiningSpace(space) ? `- 厅型：${hall0}\n` : ''}- 收纳：${storage0}｜风格：${style0}｜色板：${color0}\n- 灯光：${vibe0}｜软装：${decor0}｜强度：${intensity0}\n${hasSource ? '（默认：更贴原相＝保留窗位/透视/光向，更少变形；取消勾选会更快）\n' : ''}要不要直接生成？`,
                { options: opts, meta: { kind: 'render_flow', stage: 'fast_confirm', uploadId } }
              );
              return;
          }

          if (message.meta.stage === 'fast_confirm') {
              if (opt.includes('更贴原相') && uploadId) {
                  const current = Boolean((u?.render as any)?.preferPrecise ?? true);
                  const next = !current;
                  setUploads(prev => prev[uploadId] ? ({
                      ...prev,
                      [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), preferPrecise: next } }
                  }) : prev);
                  // Update the same message's options to reflect the checkbox state
                  setMessages(prev => prev.map(m => {
                      if (m.id !== message.id) return m;
                      const hasSource = Boolean(u?.imageUrl);
                      if (!hasSource) return m;
                      const toggleOpt = next ? '☑ 更贴原相（推荐）' : '☐ 更贴原相（更快）';
                      const rest = (m.options || []).filter(x => !String(x).includes('更贴原相'));
                      return { ...m, options: [toggleOpt, ...rest] };
                  }));
                  return;
              }
              if (opt === "直接生成（推荐）") {
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
                  const roomWidthChi = (u.render as any)?.roomWidthChi || '';
                  const roomHeightChi = (u.render as any)?.roomHeightChi || '';
                  const intake = {
                      space,
                      // 当空间类型=其他时，用于文生图锁定目标用途（否则模型容易跑偏成日式房/茶室等）
                      targetUse: (u.render as any)?.targetUse,
                      style: style0,
                      color: color0,
                      focus,
                      bedType,
                      roomWidthChi,
                      roomHeightChi,
                      storage: storage0,
                      vibe: vibe0,
                      decor: decor0,
                      intensity: intensity0,
                      hallType: hall0,
                      // pass-through for debug alignment
                      layoutVariant: (u.render as any)?.layoutVariant,
                      sizeChoice: (u.render as any)?.sizeChoice,
                      styleChoice: (u.render as any)?.styleChoice,
                      // For t2i, we keep vision summary only as structure cues (approximate)
                      visionSummary: u.visionSummary,
                      // 关键：把结构提取也带过去，供 /api/design/inspire 生成“结构锁定”提示词（更贴近原图）
                      visionExtraction: u.visionExtraction,
                      fixedConstraints: u.fixedConstraints,
                      layoutRecommended: u.layoutRecommended,
                      uploadId,
                      baseWidth: u.width,
                      baseHeight: u.height
                  };

                  setAppState('GENERATING');
                  await triggerGeneration(intake);
                  return;
              }

              // Fine-tuning entry removed for now (post-generation refinements are handled after first render).
              await typeOutAI("收到～我先按推荐预设直接出图，你之后可以基于第一张效果图再精修。");
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
              await typeOutAI("想要什么灯光氛围？（会直接影响效果图质感）", {
                  options: ["明亮通透", "温馨暖光", "高级氛围（酒店感）"],
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
              await typeOutAI("软装丰富度想要多少？（越丰富越有氛围，但也更容易显乱）", {
                  options: ["克制简洁（更清爽）", "标准搭配（推荐）", "丰富氛围（更有层次）"],
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
              const vibe = r.vibe || '温馨暖光';
              const decor = r.decor || opt;
              await typeOutAI(
                `好，我帮你用「布置：${layout}｜收纳：${storage}｜风格：${style}｜色板：${color}｜灯光：${vibe}｜软装：${decor}」出一张效果图。\n准备好就按下面开始生成～`,
                { options: ["开始生成效果图"], meta: { kind: 'render_flow', stage: 'confirm', uploadId } }
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
                  options: ["保留结构（轻改）", "明显改造（推荐）", "大改造（更大变化）"],
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
              await typeOutAI(`好，我帮你用「${style}｜${color}｜${focus}｜${storage}」出一张效果图。准备好就按下面开始生成～`, {
                  options: ["开始生成效果图"],
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
