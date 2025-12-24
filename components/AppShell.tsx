import React from 'react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto shadow-2xl overflow-hidden relative" 
      style={{
        backgroundColor: '#2A201A', 
        backgroundImage: `
          radial-gradient(1200px 600px at 50% -10%, rgba(255,255,255,0.08), transparent 60%),
          linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.38) 100%)
        `,
        backgroundSize: 'cover'
      }}>
      <div className="relative z-10 flex flex-col h-full">
        {children}
      </div>
    </div>
  );
};
