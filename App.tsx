import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from './components/AppShell';
import { AppBar } from './components/AppBar';
import { StartScreen } from './components/StartScreen';
import { MessageCard } from './components/MessageCard';
import { Composer } from './components/Composer';
import { Message } from './types';
import { analyzeImage } from './services/visionClient';
import { chatWithDeepseekStream } from './services/chatClient';
import { generateDesignImage, qaDesignImage } from './services/generateClient';
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

              // Explanation should match the final image. If backend skipped QA due to timeout budget,
              // do a background QA call (separate endpoint) so we don't block the render.
              const gotExplain = Boolean(res.designExplanation && String(res.designExplanation).trim());
              const qaSkipped = Boolean((res as any)?.debug?.qa_skipped);

              if (gotExplain && !qaSkipped) {
                await typeOutAI(
                  `【設計說明】\n${res.designExplanation}\n\n想要我哋按你單位尺寸出更準嘅櫃體分區、五金配置同報價？直接點右上角「免費跟進」WhatsApp，我哋同事一對一跟進～`
                );
              } else {
                const bgId = addLoadingToast("效果圖已出，我再幫你做一次智能复核并补充设计说明…", { loadingType: 'analyzing', uploadId: intakeData?.uploadId });
                // Show quick placeholder to keep conversation responsive
                await typeOutAI(`【設計說明】\n- 效果圖已生成，我正幫你做智能复核补充说明，请稍等…`);

                try {
                  const qaRes = await qaDesignImage({
                    imageUrl: resultUrl!,
                    renderIntake: intakeData || {},
                  });
                  stopLoadingToast(bgId);

                  if (qaRes.ok && qaRes.designExplanation) {
                    const pass = Boolean((qaRes as any)?.qa?.pass);
                    const issues = Array.isArray((qaRes as any)?.qa?.issues) ? (qaRes as any).qa.issues : [];
                    const missing = Array.isArray((qaRes as any)?.qa?.missing) ? (qaRes as any).qa.missing : [];

                    const extra =
                      pass
                        ? ''
                        : [
                            '',
                            '【智能复核】',
                            missing.length ? `- 缺失：${missing.slice(0, 5).join('、')}` : '',
                            issues.length ? `- 问题：${issues.slice(0, 5).join('；')}` : '',
                            '你想我再精修一次就回覆：「再精修：灯光更有层次／床+衣柜更清晰／减少变形」'
                          ].filter(Boolean).join('\n');

                    await typeOutAI(
                      `【設計說明（按最终效果图）】\n${qaRes.designExplanation}${extra}\n\n想要我哋按你單位尺寸出更準嘅櫃體分區、五金配置同報價？直接點右上角「免費跟進」WhatsApp，我哋同事一對一跟進～`
                    );
                  } else {
                    await typeOutAI(
                      gotExplain
                        ? `【設計說明】\n${res.designExplanation}`
                        : `【設計說明】\n- 智能复核暂时失败，但效果图已生成；你可以直接回覆想改咩位，我再帮你精修。`
                    );
                  }
                } catch (e: any) {
                  stopLoadingToast(bgId);
                  await typeOutAI(
                    gotExplain
                      ? `【設計說明】\n${res.designExplanation}`
                      : `【設計說明】\n- 智能复核暂时失败，但效果图已生成；你可以直接回覆想改咩位，我再帮你精修。`
                  );
                }
              }
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
              const focusOptions = getSuiteOptionsForSpace(space);

              await typeOutAI("呢張圖你最想做邊套方案（重點做櫃體＋整體質感）？", {
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

              // Bedroom needs one extra non-sensitive choice to avoid weird bed outputs.
              if (isBedroomLike(u.spaceType || '', opt)) {
                  await typeOutAI("睡房想做咩床型？（會影響出圖同擺位）", {
                      options: ["標準雙人床", "地台床", "榻榻米", "活動床/隱形床"],
                      meta: { kind: 'render_flow', stage: 'bed', uploadId }
                  });
              } else {
                  await typeOutAI("你想收納取向係邊種？", {
                      options: ["隱藏收納為主", "收納+展示", "收納+書枱/工作位"],
                      meta: { kind: 'render_flow', stage: 'storage', uploadId }
                  });
              }
              return;
          }

          if (message.meta.stage === 'bed') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), bedType: opt } }
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

              await typeOutAI("想要咩感覺／氛圍？（影響燈光同質感）", {
                  options: ["明亮通透", "溫馨暖光", "高級氛圍（酒店感）"],
                  meta: { kind: 'render_flow', stage: 'vibe', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'vibe') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), vibe: opt } }
              }) : prev);

              await typeOutAI("軟裝想要幾豐富？（越豐富越有氣氛）", {
                  options: ["克制簡潔（更清爽）", "標準搭配（推薦）", "豐富氛圍（更有層次）"],
                  meta: { kind: 'render_flow', stage: 'decor', uploadId }
              });
              return;
          }

          if (message.meta.stage === 'decor') {
              setUploads(prev => prev[uploadId] ? ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], render: { ...(prev[uploadId].render || {}), decor: opt } }
              }) : prev);

              const style = u.render?.style || '現代簡約';
              const color = u.render?.color || '淺木+米白';
              const focus = u.render?.focus || '全屋統一質感（牆地頂＋燈光＋軟裝）';
              const storage = u.render?.storage || '隱藏收納為主';
              const bedType = (u.render as any)?.bedType || '';
              const vibe = (u.render as any)?.vibe || '溫馨暖光';
              const decor = (u.render as any)?.decor || '標準搭配（推薦）';
              await typeOutAI(
                `好，我幫你用「${style}｜${color}｜${focus}${bedType ? `｜${bedType}` : ''}｜${storage}｜${vibe}｜${decor}」出一張效果圖（保留原本門窗/梁柱/冷氣機位）。準備好就按下面開始生成～`,
                { options: ["開始生成效果圖"], meta: { kind: 'render_flow', stage: 'confirm', uploadId } }
              );
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
              const focus = u.render?.focus || '全屋整體';
              const storage = u.render?.storage || '隱藏收納為主';
              const bedType = (u.render as any)?.bedType || '';
              const vibe = (u.render as any)?.vibe || '溫馨暖光';
              const decor = (u.render as any)?.decor || '標準搭配（推薦）';

              const genLoadingId = addLoadingToast("收到～我而家幫你生成效果圖，請稍等…", { loadingType: 'generating', uploadId });
              setAppState('GENERATING');

              const baseImage = u.dataUrl;
              // Reliability-first defaults (Vercel 60s limit): fewer steps to avoid 504.
              // StepFun doc: smaller source_weight => closer to source (less deformation)
              const genParams = { source_weight: 0.44, cfg_scale: 6.4, steps: 32 };

              const pickConstraints = (summary?: string) => {
                  if (!summary) return '';
                  const lines = summary.split('\n').map(l => l.trim()).filter(Boolean);
                  // Prefer "結構/特徵/香港" lines only
                  const picked = lines.filter(l =>
                    l.startsWith('結構：') ||
                    l.startsWith('特徵：') ||
                    l.includes('窗') ||
                    l.includes('梁') ||
                    l.includes('冷氣') ||
                    l.includes('柱') ||
                    l.includes('窗台') ||
                    l.includes('電箱') ||
                    l.includes('弱電') ||
                    l.includes('水表') ||
                    l.includes('煤氣') ||
                    l.includes('煤气')
                  );
                  const text = (picked.length ? picked : lines.slice(0, 6)).join('；');
                  return text.length > 220 ? text.slice(0, 220) + '…' : text;
              };
              const structureNotes = u.visionSummary ? `Constraints: ${pickConstraints(u.visionSummary)}` : '';

              const space = u.spaceType || 'room';
              const isDining = String(space).includes('餐') || String(space).toLowerCase().includes('dining');
              const isKitchen = String(space).includes('廚') || String(space).includes('厨');
              const isBathroom = String(space).includes('浴') || String(space).includes('衛') || String(space).includes('卫') || String(space).includes('洗手') || String(space).includes('厕所') || String(space).includes('廁');
              const hkHardConstraints =
                `Do NOT move windows/doors/beams/columns/window sills; keep camera perspective. ` +
                `Do NOT move AC unit/vents; do NOT block electrical panels/access points. ` +
                `${(isKitchen || isBathroom) ? 'Do NOT change plumbing/drain/gas/exhaust positions; keep access panels reachable. ' : ''}` +
                `INTERIOR ONLY (ignore balcony/exterior).`;

              const photorealisticSpec =
                `Photorealistic interior render based on the uploaded photo, realistic materials and lighting. ` +
                `Keep original lighting direction from windows and add warm ambient lighting.`;

              const bareShellSpec = isBareShellFromSummary(u.visionSummary)
                ? `If the room looks bare/unfinished, complete full fit-out: ceiling design (simple HK-style), lighting plan, wall paint, flooring, skirting, and appropriate soft furnishings.`
                : '';

              const suiteSpec = suiteToPrompt(space, focus, storage);
              const vibeSpec = (() => {
                const v = String(vibe || '');
                if (v.includes('明亮')) return 'Lighting mood: bright, airy, clean daylight + balanced downlights.';
                if (v.includes('酒店') || v.includes('高級') || v.includes('高级')) return 'Lighting mood: premium hotel-like layered lighting, warm accents, elegant highlights.';
                return 'Lighting mood: warm cozy ambient lighting, soft highlights, comfortable.';
              })();
              const decorSpec = (() => {
                const d = String(decor || '');
                if (d.includes('克制') || d.includes('清爽')) return 'Soft furnishing density: minimal and clean; a few key pieces only.';
                if (d.includes('豐富') || d.includes('丰富')) return 'Soft furnishing density: richer styling with rug, curtains, artwork, plants, cushions; still tidy.';
                return 'Soft furnishing density: balanced standard styling (recommended), natural and livable.';
              })();
              const bedSpec = bedType ? `Bedroom bed type: ${String(bedType).includes('地台') ? 'platform bed with storage' : String(bedType).includes('榻榻米') ? 'tatami bed with storage' : String(bedType).includes('活動') || String(bedType).includes('隐形') || String(bedType).includes('隱形') ? 'Murphy/hidden bed (residential, not medical)' : 'standard residential bed (no hospital rails)'}.` : '';

              // Keep requirements concise to avoid StepFun prompt >1024
              const requirements = [
                  `Focus: ${focus}. ${bedType ? `Bed: ${bedType}.` : ''} Storage: ${storage}. Vibe: ${vibe}. Decor: ${decor}.`,
                  photorealisticSpec,
                  hkHardConstraints,
                  `Must include: cabinetry/storage plan; ceiling + floor + wall finishes; lighting; soft furnishings.`,
                  isDining ? `Dining: include table+chairs with clear circulation; add dining sideboard/tall storage when suitable.` : '',
                  suiteSpec ? `Package: ${suiteSpec}` : '',
                  bedSpec,
                  vibeSpec,
                  decorSpec,
                  bareShellSpec,
                  `Material: ENF-grade multi-layer wood/plywood cabinetry.`,
                  structureNotes ? structureNotes : ''
              ].filter(Boolean).join(' ');

              const intake = {
                  space,
                  style,
                  color,
                  // Send structured selections to backend for better prompt alignment
                  focus,
                  bedType,
                  storage,
                  vibe,
                  decor,
                  requirements,
                  // Pass vision summary for layout constraints (no persistence; used for this generation only)
                  visionSummary: u.visionSummary,
                  uploadId,
                  baseImageBlobUrl: baseImage,
                  baseWidth: u.width,
                  baseHeight: u.height,
                  source_weight: genParams.source_weight,
                  cfg_scale: genParams.cfg_scale,
                  steps: genParams.steps
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
