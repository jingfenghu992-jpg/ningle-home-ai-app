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
      className={`nl-primary ${className || ''}`}
    >
      {label}
    </button>
  );
};

