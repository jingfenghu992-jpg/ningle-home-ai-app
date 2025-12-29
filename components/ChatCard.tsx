import React from 'react';
import { CHAT_TEXT_BASE_CLASS, CHAT_TEXT_TITLE_CLASS } from '../constants';

type ChatCardProps = {
  title?: string;
  body?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

// Rendering helper only (does not change flow/layout).
export const ChatCard: React.FC<ChatCardProps> = ({ title, body, footer, className }) => {
  return (
    <div className={`rounded-[20px] p-4 shadow-sm ${CHAT_TEXT_BASE_CLASS} ${className || ''}`}>
      {title ? <div className={`${CHAT_TEXT_TITLE_CLASS} whitespace-pre-wrap`}>{title}</div> : null}
      {body ? <div className={`whitespace-pre-wrap ${title ? 'mt-2' : ''}`}>{body}</div> : null}
      {footer ? <div className={`${title || body ? 'mt-3' : ''}`}>{footer}</div> : null}
    </div>
  );
};

