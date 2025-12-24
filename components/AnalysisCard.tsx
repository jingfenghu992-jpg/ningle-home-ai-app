import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface AnalysisCardProps {
  summary: string;
}

export const AnalysisCard: React.FC<AnalysisCardProps> = ({ summary }) => {
  const [expanded, setExpanded] = useState(false);

  // Extract bullet points. Assuming summary comes as markdown bullet points or simple lines.
  // We'll split by newline and look for list items.
  const lines = summary.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.replace(/^[-*•]\s*/, '')); // Remove bullet char

  // Logic: Show first 4 lines, then expand.
  const preview = lines.slice(0, 4);
  const rest = lines.slice(4);
  const hasMore = rest.length > 0;

  return (
    <div className="mx-4 my-4 bg-white rounded-[24px] p-6 shadow-sm border border-[#EBE8E3]/60 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2 mb-4 text-[#8A8F79] font-bold text-sm tracking-wide uppercase">
        <Sparkles size={18} />
        <span>智能分析摘要</span>
      </div>
      
      <div className="space-y-3">
        {preview.map((line, i) => (
          <div key={i} className="flex gap-3 items-start">
            <span className="text-[#8A8F79] text-xl leading-[1.4]">•</span>
            <span className="text-[#4A453C] text-[17px] leading-[1.6] font-medium">{line}</span>
          </div>
        ))}
        
        {expanded && rest.map((line, i) => (
           <div key={`more-${i}`} className="flex gap-3 items-start animate-in fade-in">
             <span className="text-[#8A8F79] text-xl leading-[1.4]">•</span>
             <span className="text-[#4A453C] text-[17px] leading-[1.6] font-medium">{line}</span>
           </div>
        ))}
      </div>

      {hasMore && (
        <button 
          onClick={() => setExpanded(!expanded)}
          className="mt-5 flex items-center justify-center gap-1.5 text-[#8A8F79] hover:text-[#6B705C] bg-[#F3F0EA] w-full py-3 rounded-xl font-semibold transition-colors"
        >
          {expanded ? (
            <>收起 <ChevronUp size={18} /></>
          ) : (
            <>展開更多 <ChevronDown size={18} /></>
          )}
        </button>
      )}
    </div>
  );
};
