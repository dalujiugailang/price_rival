import React from 'react';
import feishuIcon from '../assets/feishu.ico';

// Brand asset from https://www.feishu.cn/favicon.ico, bundled for offline use.
export default function FeishuIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <img src={feishuIcon} alt="" aria-hidden="true" className={`shrink-0 object-contain ${className}`} />;
}
