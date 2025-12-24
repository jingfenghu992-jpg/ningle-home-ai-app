import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, Search } from 'lucide-react';

type KbDoc = {
  pathname: string;
  name: string;
  size?: number;
  uploadedAt?: string;
};

export const KnowledgeBaseScreen: React.FC<{
  onBack: () => void;
}> = ({ onBack }) => {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<{ doc: KbDoc; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const r = await fetch('/api/kb/list');
        const data = await r.json();
        if (!cancelled) {
          if (data?.ok) setDocs(data.docs || []);
          else setError(data?.errorCode || data?.error || 'KB unavailable');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => (d.name || d.pathname).toLowerCase().includes(q));
  }, [docs, query]);

  const openDoc = async (doc: KbDoc) => {
    try {
      setLoading(true);
      setError(null);
      const u = `/api/kb/get?pathname=${encodeURIComponent(doc.pathname)}`;
      const r = await fetch(u);
      const data = await r.json();
      if (data?.ok) {
        setActive({ doc, text: data.text || '' });
      } else {
        setError(data?.message || data?.errorCode || 'Failed to load');
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-none">
      <div className="px-4 pt-4 pb-3 sticky top-0 z-10 bg-[#2E2C29] border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={active ? () => setActive(null) : onBack}
            className="text-[#EBE8E3]/80 hover:text-[#EBE8E3] transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="text-[#EBE8E3] font-medium text-lg">
            {active ? (active.doc.name || '知識庫') : '知識庫'}
          </div>
        </div>

        {!active && (
          <div className="mt-3 flex items-center gap-2 bg-[#1B1917] rounded-[18px] border border-white/10 px-3 py-2">
            <Search size={18} className="text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋文件..."
              className="w-full bg-transparent text-[#EBE8E3] placeholder-white/30 outline-none text-[14px]"
            />
          </div>
        )}
      </div>

      <div className="px-4 py-4">
        {error && (
          <div className="mb-4 p-4 rounded-[18px] bg-[#1B1917] border border-white/10 text-[#EBE8E3]/80 text-sm">
            {error}
          </div>
        )}

        {active ? (
          <div className="bg-[#F3F0EA] rounded-[24px] p-5 shadow-xl border border-white/20">
            <div className="text-[#4A453C] text-sm whitespace-pre-wrap leading-relaxed">
              {active.text || '（內容為空）'}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {loading && docs.length === 0 ? (
              <div className="p-4 rounded-[18px] bg-[#1B1917] border border-white/10 text-[#EBE8E3]/60 text-sm">
                正在載入知識庫...
              </div>
            ) : (
              filtered.map((d) => (
                <button
                  key={d.pathname}
                  onClick={() => openDoc(d)}
                  className="w-full text-left bg-[#F3F0EA] rounded-[22px] p-4 shadow border border-white/20 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#8A8F79] flex items-center justify-center text-white shrink-0">
                      <FileText size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[#4A453C] font-semibold text-[15px] leading-snug line-clamp-2">
                        {d.name || d.pathname}
                      </div>
                      <div className="mt-1 text-[#4A453C]/60 text-[12px]">
                        {d.pathname}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}

            {!loading && filtered.length === 0 && (
              <div className="p-4 rounded-[18px] bg-[#1B1917] border border-white/10 text-[#EBE8E3]/60 text-sm">
                找不到匹配文件
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

