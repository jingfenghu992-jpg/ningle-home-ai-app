import React from 'react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto shadow-2xl overflow-hidden relative" 
      style={{
        backgroundColor: '#46362C', 
        backgroundImage: 'url(/1_bg_texture_light.jpg)',
        backgroundBlendMode: 'multiply',
        backgroundSize: 'cover'
      }}>
      {/* Dark overlay to ensure text contrast if texture is too light */}
      <div className="absolute inset-0 bg-[#46362C]/40 pointer-events-none" />
      <div className="relative z-10 flex flex-col h-full">
        {children}
      </div>
    </div>
  );
};
