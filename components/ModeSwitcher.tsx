import React from 'react';
import { AppMode } from '../types';

interface ModeSwitcherProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ currentMode, onModeChange }) => {
  return (
    <div className="flex w-full bg-[#2E2C29] pb-4 px-4 z-20">
      <div className="flex w-full bg-[#F3F0EA]/5 rounded-[16px] p-1.5 gap-1.5 backdrop-blur-sm border border-white/5">
        <button
          onClick={() => onModeChange('consultant')}
          className={`flex-1 py-2.5 text-[15px] font-medium rounded-[12px] transition-all duration-300 ${
            currentMode === 'consultant'
              ? 'bg-[#F3F0EA] text-[#4A453C] shadow-lg shadow-black/10'
              : 'text-[#EBE8E3]/60 hover:bg-white/5 hover:text-[#EBE8E3]'
          }`}
        >
          智能顧問
        </button>
        <button
          onClick={() => onModeChange('design')}
          className={`flex-1 py-2.5 text-[15px] font-medium rounded-[12px] transition-all duration-300 ${
            currentMode === 'design'
              ? 'bg-[#F3F0EA] text-[#4A453C] shadow-lg shadow-black/10'
              : 'text-[#EBE8E3]/60 hover:bg-white/5 hover:text-[#EBE8E3]'
          }`}
        >
          智能設計
        </button>
      </div>
    </div>
  );
};

export default ModeSwitcher;
