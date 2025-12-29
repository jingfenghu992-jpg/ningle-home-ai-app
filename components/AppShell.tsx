import React from 'react';
import { CHAT_MAX_CLASS } from '../constants';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className={`flex flex-col min-h-[100dvh] w-full mx-auto ${CHAT_MAX_CLASS} bg-[#F5F2ED] shadow-2xl relative`}>
      {children}
    </div>
  );
};
