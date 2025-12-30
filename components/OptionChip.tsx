import React from 'react';

type OptionChipProps = {
  label: string;
  onClick: () => void;
  selected?: boolean;
  className?: string;
};

export const OptionChip: React.FC<OptionChipProps> = ({ label, onClick, selected, className }) => {
  const base = 'nl-chip text-[#4A453C] text-[17px] px-3 py-1.5'; // compact padding, matched font size
  const tone = selected ? 'nl-chip--selected' : '';
  // fit-content width, minimal height
  return (
    <button onClick={onClick} className={`${base} ${tone} w-auto max-w-full truncate ${className || ''}`}>
      {label}
    </button>
  );
};

