import React from 'react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto bg-warm-dark shadow-2xl overflow-hidden relative">
      {children}
    </div>
  );
};
