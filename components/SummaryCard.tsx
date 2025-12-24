import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface SummaryCardProps {
  summary: string;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ summary }) => {
  const [expanded, setExpanded] = useState(false);

  // Extract first few lines or bullet points for preview
  const lines = summary.split('\n').filter(l => l.trim().length > 0);
  const preview = lines.slice(0, 3);
  const rest = lines.slice(3);
  const hasMore = rest.length > 0;

  return (
    <div className="mx-4 my-2 bg-[#2E2C29]/50 border border-white/10 rounded-[20px] p-4 text-[#EBE8E3] backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3 text-[#8A8F79] font-medium text-xs tracking-wider uppercase">
        <Sparkles size={14} />
        <span>AI 空間分析摘要</span>
      </div>
      
      <div className="space-y-2 text-sm leading-relaxed opacity-90">
        {preview.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-[#8A8F79]">•</span>
            <span>{line.replace(/^- /, '')}</span>
          </div>
        ))}
        
        {expanded && rest.map((line, i) => (
           <div key={`more-${i}`} className="flex gap-2 animate-in fade-in">
             <span className="text-[#8A8F79]">•</span>
             <span>{line.replace(/^- /, '')}</span>
           </div>
        ))}
      </div>

      {hasMore && (
        <button 
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex items-center gap-1 text-xs text-[#8A8F79] hover:text-[#EBE8E3] transition-colors w-full justify-center py-1"
        >
          {expanded ? (
            <>收起 <ChevronUp size={14} /></>
          ) : (
            <>展開更多 <ChevronDown size={14} /></>
          )}
        </button>
      )}
    </div>
  );
};
