import React from 'react';
import { AppMode } from '../types';

interface ModeSwitcherProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ currentMode, onModeChange }) => {
  return (
    <div className="flex w-full bg-[var(--wa-header)] pb-2 px-2 z-20 shadow-md">
      <div className="flex w-full bg-[var(--wa-bg)] rounded-lg p-1 gap-1">
        <button
          onClick={() => onModeChange('consultant')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
            currentMode === 'consultant'
              ? 'bg-[var(--wa-accent)] text-white shadow-sm'
              : 'text-[var(--wa-text-secondary)] hover:bg-[var(--wa-bubble-ai)]'
          }`}
        >
          智能顧問
        </button>
        <button
          onClick={() => onModeChange('design')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
            currentMode === 'design'
              ? 'bg-[var(--wa-accent)] text-white shadow-sm'
              : 'text-[var(--wa-text-secondary)] hover:bg-[var(--wa-bubble-ai)]'
          }`}
        >
          智能設計
        </button>
      </div>
    </div>
  );
};

export default ModeSwitcher;
