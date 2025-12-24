import { list } from '@vercel/blob';
import mammoth from 'mammoth';

// In-memory cache for the serverless instance lifecycle
let kbCache = {};
let kbIndexLoaded = false;

const KB_PREFIX = 'app知识库/';

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
    const norm = text.toLowerCase().replace(/\s+/g, '');
    return ALL_KEYWORDS.some(kw => norm.includes(kw.toLowerCase()));
}

// Load KB from Blob
async function loadKnowledgeIndex() {
    if (kbIndexLoaded && Object.keys(kbCache).length > 0) return;

    try {
        console.log('[KB] Loading from Vercel Blob prefix:', KB_PREFIX);
        
        // 1. List files
        const { blobs } = await list({ prefix: KB_PREFIX });
        const docxFiles = blobs.filter(b => b.pathname.endsWith('.docx'));

        if (docxFiles.length === 0) {
            console.warn('[KB] No .docx files found in Blob storage under', KB_PREFIX);
            return;
        }

        // 2. Download and Parse (Parallel)
        await Promise.all(docxFiles.map(async (blob) => {
            const filename = blob.pathname.replace(KB_PREFIX, ''); // Clean name
            
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
    await loadKnowledgeIndex();

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
            // Sort by length desc
            bestKeyword = queryBusinessKeywords.sort((a, b) => b.length - a.length)[0];
        }

        if (bestKeyword) {
            bestIndex = normContent.indexOf(bestKeyword.toLowerCase());
        } else {
            // Priority 2: Match the longest token
            const longestToken = queryTokens.sort((a, b) => b.length - a.length)[0];
            if (longestToken && longestToken.length > 1) {
                bestIndex = normContent.indexOf(longestToken.toLowerCase());
            }
        }

        if (bestIndex === -1) bestIndex = 0;
        
        // Take window: start a bit before match (if not 0)
        // Increased context window to ensure full paragraphs are captured
        const start = Math.max(0, bestIndex - 300);
        const end = Math.min(hit.content.length, start + 2000);
        
        combinedExcerpt += hit.content.substring(start, end) + "...\n";
        usedSources.push(hit.filename);
    }

    return {
        excerpt: combinedExcerpt,
        sources: usedSources
    };
}
