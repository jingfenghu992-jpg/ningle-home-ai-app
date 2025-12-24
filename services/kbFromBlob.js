import { list } from '@vercel/blob';
import mammoth from 'mammoth';

// In-memory cache for the serverless instance lifecycle
let kbCache = {};
let kbIndexLoaded = false;

// 统一与线上 Vercel Blob 目录一致（你截图里是「应用知识库/」）
// 同时保留旧前缀作为兼容（避免历史数据或文档不一致导致查不到）
const KB_PREFIXES = ['应用知识库/', '應用知識庫/', 'app知识库/'];

// Business Keywords for Strict Trigger (Merged from your requirements)
export const BUSINESS_KEYWORDS = {
    MATERIALS: ["板材", "五金", "夹板", "多层板", "生态板", "E0", "E1", "ENF", "防潮", "耐磨", "封边", "饰面", "甲醛", "鉸鏈", "铰链", "铰鍊", "路轨", "滑轨", "趟门", "缓冲", "拉手", "吊轨", "百隆", "海蒂诗", "DTC", "Blum", "Hettich"],
    PRICING: ["价钱", "價錢", "幾錢", "几钱", "报价", "预算", "一口价", "套餐", "计价", "投影面积", "展开面积", "增项", "price", "cost", "quote", "平方"],
    COMPANY: ["工厂", "源头工厂", "源头", "展厅", "门店", "地址", "香港", "深圳", "惠州", "交期", "company", "factory", "showroom", "宁乐", "寧樂"],
    PROCESS: ["量尺", "度尺", "上门", "设计", "出图", "下单", "生产", "运输", "安装", "验收", "保养", "流程", "design", "install", "售后", "维保"],
    HOUSING: ["公屋", "居屋", "HOS", "私楼", "纳米楼", "唐楼", "收纳", "空间规划", "户型", "房"],
    STYLE: ["现代", "日系", "轻奢", "奶油", "木系", "灰白", "配色", "灯光", "style"]
};

// Flatten keywords for easy searching
const ALL_KEYWORDS = [
    ...BUSINESS_KEYWORDS.MATERIALS,
    ...BUSINESS_KEYWORDS.PRICING,
    ...BUSINESS_KEYWORDS.COMPANY,
    ...BUSINESS_KEYWORDS.PROCESS,
    ...BUSINESS_KEYWORDS.HOUSING,
    ...BUSINESS_KEYWORDS.STYLE
];

// Check if user text hits any business keyword
export function shouldUseKnowledge(text) {
    if (!text) return false;
    return true; // Always on
}

// Load KB from Blob
async function loadKnowledgeIndex() {
    if (kbIndexLoaded && Object.keys(kbCache).length > 0) return;

    try {
        console.log('[KB] Loading from Vercel Blob prefixes:', KB_PREFIXES);

        // Wrap list call in try-catch to handle missing blob token or permission errors gracefully
        const listResults = await Promise.allSettled(
            KB_PREFIXES.map((prefix) => list({ prefix }))
        );

        const blobs = listResults
            .filter((r) => r.status === 'fulfilled')
            // @ts-ignore
            .flatMap((r) => r.value?.blobs || []);
        
        const docxFiles = blobs.filter(b => 
            b.pathname.toLowerCase().endsWith('.docx') || 
            b.pathname.toLowerCase().endsWith('.doc')
        );

        if (docxFiles.length === 0) {
            console.warn('[KB] No .docx/.doc files found in Blob storage under', KB_PREFIX);
            return;
        }

        // 2. Download and Parse (Parallel)
        await Promise.all(docxFiles.map(async (blob) => {
            // Clean name: remove any matched prefix for display/cache key
            let filename = blob.pathname;
            for (const prefix of KB_PREFIXES) {
                if (filename.startsWith(prefix)) {
                    filename = filename.replace(prefix, '');
                    break;
                }
            }
            
            // Check cache first (by simple name for now, ideally etag)
            if (kbCache[filename]) return;

            try {
                // Download
                const response = await fetch(blob.downloadUrl);
                if (!response.ok) throw new Error(`Failed to download ${blob.url}`);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Parse docx
                const result = await mammoth.extractRawText({ buffer: buffer });
                const text = result.value;
                
                // Store in cache
                kbCache[filename] = text;
                console.log(`[KB] Loaded: ${filename} (${text.length} chars)`);
            } catch (err) {
                console.error(`[KB] Error loading ${filename}:`, err);
            }
        }));

        kbIndexLoaded = true;
    } catch (error) {
        console.error('[KB] Failed to load index:', error);
        // Don't throw, just let it fail gracefully (empty cache)
    }
}

// Search KB
export async function searchKnowledge(query) {
    // Ensure loading logic is safe
    try {
        await loadKnowledgeIndex();
    } catch (e) {
        console.error('[KB] Critical error loading knowledge base:', e);
        return { excerpt: "", sources: [] };
    }

    const normQuery = query.toLowerCase();
    const hits = [];

    // Identify which business keywords are in the query
    const queryBusinessKeywords = ALL_KEYWORDS.filter(kw => normQuery.includes(kw.toLowerCase()));
    
    // Also use simple tokens as fallback
    const queryTokens = normQuery.split(/[\s,，.。？?！!]+/).filter(t => t.length > 1);

    for (const [filename, content] of Object.entries(kbCache)) {
        let score = 0;
        const normContent = content.toLowerCase();

        // 1. Boost score for Business Keywords present in both Query and Doc
        for (const kw of queryBusinessKeywords) {
            if (normContent.includes(kw.toLowerCase())) {
                score += 10; // High weight for exact business term match
            }
        }

        // 2. Fallback token matching
        for (const token of queryTokens) {
            if (normContent.includes(token)) {
                score += 1;
            }
        }
        
        // 3. Document relevance boost (Naive)
        if ((normQuery.includes("价") || normQuery.includes("钱")) && filename.includes("价")) {
            score += 20;
        }

        if (score > 0) {
            hits.push({ filename, content, score });
        }
    }

    // Sort by score
    hits.sort((a, b) => b.score - a.score);

    // Pick top 2 docs
    const topHits = hits.slice(0, 2);
    
    if (topHits.length === 0) {
        return { excerpt: "", sources: [] };
    }

    let combinedExcerpt = "";
    const usedSources = [];

    for (const hit of topHits) {
        combinedExcerpt += `\n【参考资料：${hit.filename}】\n`;
        
        // Find best window for extraction
        let bestIndex = -1;
        const normContent = hit.content.toLowerCase();
        
        // Priority 1: Match the longest Business Keyword found in query
        let bestKeyword = "";
        if (queryBusinessKeywords.length > 0) {
            bestKeyword = queryBusinessKeywords.sort((a, b) => b.length - a.length)[0];
        }

        if (bestKeyword) {
            bestIndex = normContent.indexOf(bestKeyword.toLowerCase());
        } else {
            const longestToken = queryTokens.sort((a, b) => b.length - a.length)[0];
            if (longestToken && longestToken.length > 1) {
                bestIndex = normContent.indexOf(longestToken.toLowerCase());
            }
        }

        if (bestIndex === -1) bestIndex = 0;
        
        const start = Math.max(0, bestIndex - 500); 
        const end = Math.min(hit.content.length, start + 3000); 
        
        combinedExcerpt += hit.content.substring(start, end) + "...\n";
        usedSources.push(hit.filename);
    }

    return {
        excerpt: combinedExcerpt,
        sources: usedSources
    };
}
