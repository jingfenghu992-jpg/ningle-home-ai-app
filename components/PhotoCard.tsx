import React from 'react';
import { ZoomIn, Clock } from 'lucide-react';

interface PhotoCardProps {
  imageUrl: string;
  status: 'waiting' | 'analyzing' | 'done' | 'rendering';
  timestamp?: number;
  onExpand?: () => void;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ imageUrl, status, timestamp, onExpand }) => {
  const getStatusBadge = () => {
    switch(status) {
      case 'waiting': return { text: '待確認空間', color: 'bg-yellow-500/80' };
      case 'analyzing': return { text: '分析中...', color: 'bg-blue-500/80' };
      case 'rendering': return { text: '生成中...', color: 'bg-purple-500/80' };
      case 'done': return { text: '已分析', color: 'bg-[#8A8F79]' };
      default: return { text: '已上傳', color: 'bg-gray-500/80' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="relative group rounded-[20px] overflow-hidden shadow-lg border-2 border-[#F3F0EA]/10 shrink-0 mx-4 mt-4 mb-2">
      <div className="aspect-video w-full bg-black/20 relative">
        <img src={imageUrl} alt="Room" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        <button 
          onClick={onExpand}
          className="absolute top-2 right-2 p-2 bg-black/30 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        >
          <ZoomIn size={18} />
        </button>
      </div>
      
      <div className="absolute top-3 left-3 flex items-center gap-2">
         <span className={`text-xs font-bold text-white px-2.5 py-1 rounded-full backdrop-blur-md ${badge.color}`}>
           {badge.text}
         </span>
      </div>

      {timestamp && (
        <div className="absolute bottom-2 right-3 flex items-center gap-1 text-white/80 text-[10px] bg-black/30 px-2 py-0.5 rounded-full backdrop-blur-sm">
          <Clock size={10} />
          <span>{new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
      )}
    </div>
  );
};
