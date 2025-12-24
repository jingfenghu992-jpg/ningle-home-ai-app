import React from 'react';
import { ArrowDownCircle } from 'lucide-react';

interface NextStepCardProps {
  text: string;
}

export const NextStepCard: React.FC<NextStepCardProps> = ({ text }) => {
  return (
    <div className="mx-4 my-2 p-4 bg-[#F3F0EA] rounded-[20px] shadow-sm border border-white/10 flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="text-[#8A8F79] mt-0.5">
        <ArrowDownCircle size={20} />
      </div>
      <div className="text-[#4A453C] text-sm font-medium leading-relaxed">
        {text}
      </div>
    </div>
  );
};
