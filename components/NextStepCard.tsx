import React from 'react';
import { ArrowDownCircle } from 'lucide-react';

interface NextStepCardProps {
  text: string;
}

export const NextStepCard: React.FC<NextStepCardProps> = ({ text }) => {
  return (
    <div
      className="mx-4 my-2 p-4 bg-white rounded-[16px] shadow-sm border border-[var(--app-border)] flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ boxShadow: 'var(--elev-0)' }}
    >
      <div className="text-[var(--app-primary)] mt-0.5">
        <ArrowDownCircle size={20} />
      </div>
      <div className="text-[var(--app-text-main)] text-sm font-medium leading-relaxed">
        {text}
      </div>
    </div>
  );
};
