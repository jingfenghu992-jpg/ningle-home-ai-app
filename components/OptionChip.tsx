import React from 'react';

type OptionChipProps = {
  label: string;
  onClick: () => void;
  selected?: boolean;
  className?: string;
};

export const OptionChip: React.FC<OptionChipProps> = ({ label, onClick, selected, className }) => {
  const base =
    'inline-flex items-center justify-center h-11 px-3 text-[14px] leading-6 font-medium rounded-xl border transition-all shadow-sm active:scale-95 whitespace-nowrap';
  const tone = selected
    ? 'bg-white text-[#4A453C] border-black/10'
    : 'bg-white/60 hover:bg-white text-[#4A453C] border-black/5';
  return (
    <button onClick={onClick} className={`${base} ${tone} min-w-[140px] w-auto ${className || ''}`}>
      {label}
    </button>
  );
};

