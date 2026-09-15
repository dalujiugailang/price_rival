import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function RepricingControlsPopover({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!expanded) return;
    const updatePosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      if (trigger.bottom < 0 || trigger.top > window.innerHeight) { setExpanded(false); return; }
      const height = panelRef.current?.getBoundingClientRect().height ?? 280;
      const width = panelRef.current?.getBoundingClientRect().width ?? 240;
      const below = trigger.bottom + 6;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, trigger.top - height - 6);
      const left = Math.max(12, Math.min(trigger.left, window.innerWidth - width - 12));
      setPosition(current => current.top === top && current.left === left ? current : { top, left });
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setExpanded(false);
      triggerRef.current?.focus();
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);

  return <>
    <button ref={triggerRef} type="button" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => setExpanded(value => !value)}
      className={`flex shrink-0 items-center gap-2 border border-[#141414] px-3 py-1 text-xs font-bold ${expanded ? 'bg-[#141414] text-white' : 'bg-white hover:bg-[#141414] hover:text-white'}`}>
      到手追价 <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
    </button>
    {expanded && createPortal(
      <aside ref={panelRef} id={panelId} aria-label="到手价两步追价"
        className="fixed z-50 w-60 max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] overflow-auto space-y-2 border border-[#141414] bg-[#F0EFEC] p-3 text-[11px] shadow-[3px_3px_0_#14141430]"
        style={position}>
        {children}
      </aside>, document.body
    )}
  </>;
}
