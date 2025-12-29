import React from 'react';

type PrimaryActionButtonProps = {
  label: string;
  onClick: () => void;
  className?: string;
};

export const PrimaryActionButton: React.FC<PrimaryActionButtonProps> = ({ label, onClick, className }) => {
  return (
    <button
      onClick={onClick}
      className={`w-full h-11 px-4 text-[14px] leading-6 font-semibold rounded-xl border border-black/10 bg-white/80 hover:bg-white text-[#4A453C] transition-all shadow-sm active:scale-95 ${className || ''}`}
    >
      {label}
    </button>
  );
};

