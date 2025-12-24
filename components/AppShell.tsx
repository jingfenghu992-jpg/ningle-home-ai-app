import React from 'react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="app-warm-grain flex flex-col h-[100dvh] w-full max-w-md mx-auto shadow-2xl overflow-hidden relative">
      {children}
    </div>
  );
};
