import React from 'react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="relative flex flex-col h-[100dvh] w-full max-w-md mx-auto shadow-2xl overflow-hidden">
      {/* Warm grain background (clipped to app container) */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_0%,#7b523e_0%,#3d2b25_42%,#231e1c_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(110%_85%_at_50%_32%,rgba(255,228,196,0.22)_0%,rgba(255,228,196,0.06)_42%,rgba(255,228,196,0)_72%)]" />
      <div className="absolute inset-0 opacity-32 mix-blend-overlay pointer-events-none bg-[url('/grain.svg')] bg-repeat" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(90%_90%_at_50%_30%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.28)_68%,rgba(0,0,0,0.55)_100%)]" />

      <div className="relative flex flex-col h-full">
        {children}
      </div>
    </div>
  );
};
