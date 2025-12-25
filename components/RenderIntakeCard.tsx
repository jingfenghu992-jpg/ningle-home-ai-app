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
          ? 'text-white border-[var(--app-primary)]' 
          : 'bg-white border-[var(--app-border)] text-[var(--app-text-main)] hover:border-[var(--app-primary)]/40'
      }`}
      style={selected ? { backgroundColor: 'var(--app-primary)' } : undefined}
    >
      {label}
    </button>
  );

  if (step === 'ready') {
    return (
      <div className="mx-4 my-4 bg-white rounded-[16px] p-6 border border-[var(--app-border)] animate-in zoom-in-95" style={{ boxShadow: 'var(--elev-1)' }}>
        <h3 className="text-xl font-bold text-[var(--app-text-main)] mb-2">準備好啦！</h3>
        <div className="space-y-2 mb-6 text-sm text-[var(--app-text-muted)] bg-[var(--app-bg)] p-4 rounded-xl border border-[var(--app-divider)]">
          <p>• 風格：{data.style}</p>
          <p>• 色系：{data.color}</p>
          <p>• 重點：{data.cabinets}</p>
          <p>• 避開：{data.constraints}</p>
        </div>
        <button 
          onClick={() => onComplete(data)}
          className="w-full text-white py-4 rounded-xl font-bold text-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
          style={{ backgroundColor: 'var(--app-primary)', boxShadow: '0 10px 24px rgba(20,83,45,0.18)' }}
        >
          <Check size={20} />
          開始生成智能效果圖
        </button>
        <button 
          onClick={() => setStep('style')}
          className="w-full mt-3 text-[var(--app-text-muted)] text-sm py-2 hover:text-[var(--app-text-main)] transition-colors"
        >
          重新選擇
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 my-4 bg-white rounded-[16px] p-6 border border-[var(--app-border)] animate-in fade-in slide-in-from-bottom-2" style={{ boxShadow: 'var(--elev-0)' }}>
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-[var(--app-text-main)]">
          {step === 'style' && '1. 想行咩風格？'}
          {step === 'color' && '2. 想偏咩色系？'}
          {step === 'cabinets' && '3. 最想做邊啲櫃？'}
          {step === 'constraints' && '4. 有冇位要避開？'}
        </h3>
        <span className="text-xs font-mono text-[var(--app-primary)] bg-[var(--app-bg)] px-2 py-1 rounded-md border border-[var(--app-divider)]">
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
