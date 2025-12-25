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
    <div className="mx-4 my-2 bg-white border border-[var(--app-border)] rounded-[16px] p-4 text-[var(--app-text-main)]" style={{ boxShadow: 'var(--elev-0)' }}>
      <div className="flex items-center gap-2 mb-3 text-[var(--app-primary)] font-semibold text-xs tracking-wide">
        <Sparkles size={14} />
        <span>空間分析摘要</span>
      </div>
      
      <div className="space-y-2 text-sm leading-relaxed">
        {preview.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-[var(--app-primary)]">•</span>
            <span className="text-[var(--app-text-main)]">{line.replace(/^- /, '')}</span>
          </div>
        ))}
        
        {expanded && rest.map((line, i) => (
           <div key={`more-${i}`} className="flex gap-2 animate-in fade-in">
             <span className="text-[var(--app-primary)]">•</span>
             <span className="text-[var(--app-text-main)]">{line.replace(/^- /, '')}</span>
           </div>
        ))}
      </div>

      {hasMore && (
        <button 
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex items-center gap-1 text-xs text-[var(--app-primary)] hover:opacity-90 transition-opacity w-full justify-center py-1"
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
