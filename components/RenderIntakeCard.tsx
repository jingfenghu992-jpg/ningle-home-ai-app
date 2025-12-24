import React, { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';

interface RenderIntakeCardProps {
  onComplete: (data: any) => void;
}

type Step = 'style' | 'color' | 'cabinets' | 'constraints' | 'ready';

export const RenderIntakeCard: React.FC<RenderIntakeCardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<Step>('style');
  const [data, setData] = useState({
    style: '',
    color: '',
    cabinets: '',
    constraints: ''
  });

  const handleSelect = (key: keyof typeof data, value: string) => {
    setData(prev => ({ ...prev, [key]: value }));
    
    // Auto advance
    if (key === 'style') setStep('color');
    else if (key === 'color') setStep('cabinets');
    else if (key === 'cabinets') setStep('constraints');
    else if (key === 'constraints') setStep('ready');
  };

  const OptionBtn = ({ label, selected }: { label: string, selected: boolean }) => (
    <button 
      onClick={() => handleSelect(step as any, label)}
      className={`px-4 py-3 rounded-xl border text-left transition-all ${
        selected 
          ? 'bg-[#8A8F79] text-white border-[#8A8F79]' 
          : 'bg-white border-[#EBE8E3] text-[#4A453C] hover:border-[#8A8F79]/50'
      }`}
    >
      {label}
    </button>
  );

  if (step === 'ready') {
    return (
      <div className="mx-4 my-4 bg-white rounded-[24px] p-6 shadow-md border-2 border-[#8A8F79]/20 animate-in zoom-in-95">
        <h3 className="text-xl font-bold text-[#4A453C] mb-2">準備好啦！</h3>
        <div className="space-y-2 mb-6 text-sm text-[#4A453C]/70 bg-[#F3F0EA] p-4 rounded-xl">
          <p>• 風格：{data.style}</p>
          <p>• 色系：{data.color}</p>
          <p>• 重點：{data.cabinets}</p>
          <p>• 避開：{data.constraints}</p>
        </div>
        <button 
          onClick={() => onComplete(data)}
          className="w-full bg-[#8A8F79] text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-[#6B705C] transition-transform active:scale-95 flex items-center justify-center gap-2"
        >
          <Check size={20} />
          開始生成智能效果圖
        </button>
        <button 
          onClick={() => setStep('style')}
          className="w-full mt-3 text-[#4A453C]/50 text-sm py-2"
        >
          重新選擇
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 my-4 bg-white rounded-[24px] p-6 shadow-sm border border-[#EBE8E3] animate-in fade-in slide-in-from-bottom-2">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-[#4A453C]">
          {step === 'style' && '1. 想行咩風格？'}
          {step === 'color' && '2. 想偏咩色系？'}
          {step === 'cabinets' && '3. 最想做邊啲櫃？'}
          {step === 'constraints' && '4. 有冇位要避開？'}
        </h3>
        <span className="text-xs font-mono text-[#8A8F79] bg-[#F3F0EA] px-2 py-1 rounded-md">
          {step === 'style' ? '1/4' : step === 'color' ? '2/4' : step === 'cabinets' ? '3/4' : '4/4'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {step === 'style' && ['現代簡約', '奶油風', '自然木系', '輕奢風', '北歐風'].map(opt => (
          <OptionBtn key={opt} label={opt} selected={data.style === opt} />
        ))}
        {step === 'color' && ['純白為主', '淺木色', '深木色', '黑白灰', '暖灰色'].map(opt => (
          <OptionBtn key={opt} label={opt} selected={data.color === opt} />
        ))}
        {step === 'cabinets' && ['全屋收納 (衣櫃/儲物)', '客廳電視牆', '玄關鞋櫃', '睡房地台床', '廚房廚櫃'].map(opt => (
          <OptionBtn key={opt} label={opt} selected={data.cabinets === opt} />
        ))}
        {step === 'constraints' && ['無 (全拆)', '保留窗台', '避開冷氣機位', '保留現有地板', '避開電箱位'].map(opt => (
          <OptionBtn key={opt} label={opt} selected={data.constraints === opt} />
        ))}
      </div>
    </div>
  );
};
