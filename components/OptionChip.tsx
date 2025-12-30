import React from 'react';

type OptionChipProps = {
  label: string;
  onClick: () => void;
  selected?: boolean;
  className?: string;
};

export const OptionChip: React.FC<OptionChipProps> = ({ label, onClick, selected, className }) => {
  const base = 'nl-chip text-[#4A453C] text-[15px] px-1'; // reduced padding for 4-col
  const tone = selected ? 'nl-chip--selected' : '';
  // Removed min-w-[140px] constraint to allow 4-col grid
  return (
    <button onClick={onClick} className={`${base} ${tone} w-auto ${className || ''}`}>
      {label}
    </button>
  );
};

