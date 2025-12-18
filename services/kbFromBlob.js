import { list } from '@vercel/blob';
import mammoth from 'mammoth';

// In-memory cache for the serverless instance lifecycle
let kbCache = {};
let kbIndexLoaded = false;

const KB_PREFIX = '应用知识库/';

// Business Keywords for Strict Trigger (Merged from your requirements)
export const BUSINESS_KEYWORDS = {
    MATERIALS: ["板材", "五金", "夹板", "多层板", "生态板", "E0", "E1", "ENF", "防潮", "耐磨", "封边", "饰面", "甲醛", "鉸鏈", "铰链", "铰鍊", "路轨", "滑轨", "趟门", "缓冲", "拉手", "吊轨", "百隆", "海蒂诗", "DTC", "Blum", "Hettich"],
    PRICING: ["价钱", "價錢", "幾錢", "几钱", "报价", "预算", "一口价", "套餐", "计价", "投影面积", "展开面积", "增项", "price", "cost", "quote"],
    COMPANY: ["工厂", "源头工厂", "源头", "展厅", "门店", "地址", "香港", "深圳", "惠州", "交期", "company", "factory", "showroom"],
    PROCESS: ["量尺", "度尺", "上门", "设计", "出图", "下单", "生产", "运输", "安装", "验收", "保养", "流程", "design", "install", "售后", "维保"],
    HOUSING: ["公屋", "居屋", "HOS", "私楼", "纳米楼", "唐楼", "收纳", "空间规划", "户型", "房"],
    STYLE: ["现代", "日系", "轻奢", "奶油", "木系", "灰白", "配色", "灯光", "style"]
};

// Check if user text hits any business keyword
export function shouldUseKnowledge(text) {
    if (!text) return false;
    const norm = text.toLowerCase().replace(/\s+/g, '');
    
    // Check all categories
    const allKeywords = [
        ...BUSINESS_KEYWORDS.MATERIALS,
        ...BUSINESS_KEYWORDS.PRICING,
        ...BUSINESS_KEYWORDS.COMPANY,
        ...BUSINESS_KEYWORDS.PROCESS,
        ...BUSINESS_KEYWORDS.HOUSING,
        ...BUSINESS_KEYWORDS.STYLE
    ];

    return allKeywords.some(kw => norm.includes(kw.toLowerCase()));
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

    // Simple keyword matching scoring
    for (const [filename, content] of Object.entries(kbCache)) {
        let score = 0;
        const normContent = content.toLowerCase();

        // 1. Check strict keywords present in query against content
        // (If user asks about "E0", and doc mentions "E0", boost score)
        // This is a bit naive, ideally we'd search for the *answer* to the query.
        // For now, we return the document if it contains the keywords from the query.
        
        // Find matched keywords from query
        // This logic is: if doc contains "E0" and query contains "E0", big boost.
        // Just checking overlap count.
        const queryTokens = normQuery.split(/[\s,，.。？?！!]+/).filter(t => t.length > 1);
        
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

    // Pick top 1-2 docs
    const topHits = hits.slice(0, 2);
    
    if (topHits.length === 0) {
        return { excerpt: "", sources: [] };
    }

    // Extract relevant chunks from matched docs
    // Naive extraction: First 1000-1500 chars or simple keyword window
    // Better: Find the first occurrence of the highest value keyword?
    // For MVP, returning the first 1200 chars of the most relevant doc is often enough for "Context".
    // Or combining them.
    
    let combinedExcerpt = "";
    const usedSources = [];

    for (const hit of topHits) {
        // Simple "Header" context
        combinedExcerpt += `\n【参考资料：${hit.filename}】\n`;
        
        // Try to find a relevant window if possible, else start of file
        // For structured docs (like FAQ), simple text search usually hits the right spot?
        // Let's just dump the first 1500 chars per doc to fit token limits. 
        // If doc is huge, we might miss the middle. 
        // Improvement: Regex search for the specific keyword in doc and take window.
        
        // Find best window
        let bestIndex = -1;
        const normContent = hit.content.toLowerCase();
        // Try to find the rarest keyword from query in content?
        // Let's just find the first match of the *longest* token in query.
        const longestToken = query.split(/[\s,，.。？?！!]+/).sort((a, b) => b.length - a.length)[0];
        
        if (longestToken && longestToken.length > 1) {
            bestIndex = normContent.indexOf(longestToken.toLowerCase());
        }

        if (bestIndex === -1) bestIndex = 0;
        
        // Take window: start a bit before match (if not 0)
        const start = Math.max(0, bestIndex - 200);
        const end = Math.min(hit.content.length, start + 1200);
        
        combinedExcerpt += hit.content.substring(start, end) + "...\n";
        usedSources.push(hit.filename);
    }

    return {
        excerpt: combinedExcerpt,
        sources: usedSources
    };
}
