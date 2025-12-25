import React from 'react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="flex flex-col min-h-[100dvh] w-full max-w-md mx-auto bg-[#F5F2ED] shadow-2xl relative">
      {children}
    </div>
  );
};
