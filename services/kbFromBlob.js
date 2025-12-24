import fs from 'fs';
import path from 'path';

// In-memory cache for the serverless instance lifecycle
let kbCache = {};
let kbIndexLoaded = false;

// Determine correct path for Vercel/Local environment
// In Vercel, process.cwd() is the root of the project
const LOCAL_KB_DIR = path.join(process.cwd(), 'knowledge_text');

// Business Keywords for Strict Trigger
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

// Load KB from Local Files
async function loadKnowledgeIndex() {
    if (kbIndexLoaded && Object.keys(kbCache).length > 0) return;

    try {
        console.log('[KB] Loading from local directory:', LOCAL_KB_DIR);
        
        if (!fs.existsSync(LOCAL_KB_DIR)) {
             console.error('[KB] Directory not found:', LOCAL_KB_DIR);
             // In Vercel, we might need to check if files are bundled correctly
             // But usually process.cwd() works for included static files
             return;
        }

        const files = fs.readdirSync(LOCAL_KB_DIR).filter(f => f.endsWith('.txt'));

        if (files.length === 0) {
            console.warn('[KB] No .txt files found in', LOCAL_KB_DIR);
            return;
        }

        for (const filename of files) {
            if (kbCache[filename]) continue;
            
            try {
                const filePath = path.join(LOCAL_KB_DIR, filename);
                const text = fs.readFileSync(filePath, 'utf-8');
                kbCache[filename] = text;
                console.log(`[KB] Loaded: ${filename} (${text.length} chars)`);
            } catch (err) {
                 console.error(`[KB] Error loading ${filename}:`, err);
            }
        }

        kbIndexLoaded = true;
    } catch (error) {
        console.error('[KB] Failed to load index:', error);
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

        // 1. Basic Keyword Scoring
        // Break query into tokens (handling CJK loosely)
        // Filter out very short tokens
        const queryTokens = normQuery.split(/[\s,，.。？?！!]+/).filter(t => t.length > 1);
        
        for (const token of queryTokens) {
            // Count occurrences or just check presence
            // Presence is enough for document selection
            if (normContent.includes(token)) {
                score += 10; // Base score for hit
                
                // Boost for exact phrase match if token is long
                if (token.length > 2) score += 5;
            }
        }
        
        // Boost if filename itself matches query (metadata match)
        for (const token of queryTokens) {
            if (filename.toLowerCase().includes(token)) {
                score += 20;
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

    // Extract relevant chunks
    let combinedExcerpt = "";
    const usedSources = [];

    for (const hit of topHits) {
        combinedExcerpt += `\n【参考资料：${hit.filename}】\n`;
        
        // Find best window
        let bestIndex = -1;
        const normContent = hit.content.toLowerCase();
        
        // Strategy: Find the query token that appears least frequently in the doc? 
        // Or just the first occurrence of the longest token.
        // Let's go with longest token for now.
        const longestToken = query.split(/[\s,，.。？?！!]+/).sort((a, b) => b.length - a.length)[0];
        
        if (longestToken && longestToken.length > 1) {
            bestIndex = normContent.indexOf(longestToken.toLowerCase());
        }

        if (bestIndex === -1) bestIndex = 0;
        
        // Take window
        // Start 200 chars before match (context)
        const start = Math.max(0, bestIndex - 200);
        // End 1500 chars after start
        const end = Math.min(hit.content.length, start + 1500);
        
        combinedExcerpt += hit.content.substring(start, end) + "...\n";
        usedSources.push(hit.filename);
    }

    return {
        excerpt: combinedExcerpt,
        sources: usedSources
    };
}
