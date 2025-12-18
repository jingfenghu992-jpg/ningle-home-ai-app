import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(process.cwd(), 'knowledge');
const TARGET_DIR = path.join(process.cwd(), 'knowledge_text');

// Ensure target directory exists
if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// Map 12 source files to 5 target documents
const MAPPING = {
    '板材與五金百科（香港全屋訂造版 V4.1）.txt': [
        '02_materials.md',
        '04_hardware.md',
        '10_faq_material_comparison.md'
    ],
    '寧樂家居_全屋訂造一口價方案_Ningle-HK-Q7-2025.txt': [
        '06_pricing_wardrobe.md',
        '07_pricing_kitchen.md',
        '08_pricing_bed.md',
        '09_pricing_packages.md'
    ],
    '香港全屋訂造設計指南（加強專業版 V4.1）.txt': [
        '05_process.md',
        '11_faq_time_formaldehyde.md',
        '01_company.md' // Include company info here as it's part of the process/trust
    ],
    '香港戶型大全（全屋訂造 · 加強專業版 V4.1）.txt': [
        '12_notes.md'
        // In a real scenario, this would have more specific layout info. 
        // For now, mapping general notes here.
    ],
    '香港家居風格與配色指南（全屋訂造版 V4.1）.txt': [
        '03_finishes.md'
    ]
};

console.log('Building Knowledge Base Text Cache...');

let totalFiles = 0;

for (const [targetFile, sourceFiles] of Object.entries(MAPPING)) {
    let content = '';
    console.log(`Generating: ${targetFile}`);
    
    sourceFiles.forEach(sourceName => {
        const sourcePath = path.join(SOURCE_DIR, sourceName);
        if (fs.existsSync(sourcePath)) {
            const fileContent = fs.readFileSync(sourcePath, 'utf8');
            content += `\n\n=== SECTION: ${sourceName.replace('.md', '')} ===\n\n`;
            content += fileContent;
        } else {
            console.warn(`  Warning: Source file ${sourceName} not found.`);
        }
    });

    fs.writeFileSync(path.join(TARGET_DIR, targetFile), content.trim());
    totalFiles++;
}

console.log(`Successfully built ${totalFiles} knowledge documents in ${TARGET_DIR}`);
