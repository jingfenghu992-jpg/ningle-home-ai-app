import React from 'react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="relative flex flex-col h-[100dvh] w-full max-w-md mx-auto shadow-2xl overflow-hidden">
      {/* Warm grain background (clipped to app container) */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_0%,#6b4a3b_0%,#3a2d28_45%,#2b2522_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,rgba(255,214,170,0.25)_0%,rgba(255,214,170,0)_65%)]" />
      <div className="absolute inset-0 opacity-35 mix-blend-overlay pointer-events-none bg-[url('/grain.svg')] bg-repeat" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(90%_90%_at_50%_35%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.35)_70%,rgba(0,0,0,0.55)_100%)]" />

      <div className="relative flex flex-col h-full">
        {children}
      </div>
    </div>
  );
};
