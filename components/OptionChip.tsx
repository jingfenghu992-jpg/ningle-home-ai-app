import React from 'react';

type OptionChipProps = {
  label: string;
  onClick: () => void;
  selected?: boolean;
  className?: string;
};

export const OptionChip: React.FC<OptionChipProps> = ({ label, onClick, selected, className }) => {
  const base = 'nl-chip text-[#4A453C]';
  const tone = selected ? 'nl-chip--selected' : '';
  return (
    <button onClick={onClick} className={`${base} ${tone} min-w-[140px] w-auto ${className || ''}`}>
      {label}
    </button>
  );
};

