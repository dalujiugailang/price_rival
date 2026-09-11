import React, { useEffect, useRef, useState } from 'react';

export interface TourStep {
  target: string;
  title: string;
  body: string;
  tab?: string;
  chapter?: string;
  action?: string;
  fallbackTarget?: string;
  unavailable?: string;
  placement?: 'below';
}
interface Props {
  open: boolean;
  steps: TourStep[];
  currentIndex: number;
  onPause: () => void;
  onFinish: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSelect: (index: number) => void;
}
type Rect = { top: number; left: number; width: number; height: number };
export default function OnboardingTour({ open, steps, currentIndex, onPause, onFinish, onNext, onPrev, onSelect }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [cardHeight, setCardHeight] = useState(320);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[currentIndex];

  useEffect(() => {
    if (!open || !step) return;
    let frame = 0;
    let scrolledElement: HTMLElement | null = null;
    const find = (target?: string) => {
      if (!target) return null;
      return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
        .find(element => element.getClientRects().length > 0) || null;
    };
    const measure = () => {
      const primary = find(step.target);
      const element = primary || find(step.fallbackTarget);
      setMissing(!primary);
      setViewport(previous => previous.width === window.innerWidth && previous.height === window.innerHeight
        ? previous : { width: window.innerWidth, height: window.innerHeight });
      if (!element) { setRect(null); return; }
      if (element !== scrolledElement) {
        scrolledElement = element;
        element.scrollIntoView({ block: step.placement === 'below' ? 'start' : 'center', inline: 'nearest', behavior: 'instant' });
      }
      const bounds = element.getBoundingClientRect();
      const top = Math.max(4, bounds.top - 6);
      const left = Math.max(4, bounds.left - 6);
      const next = { top, left, width: Math.max(0, Math.min(window.innerWidth - 4, bounds.right + 6) - left),
        height: Math.max(0, Math.min(window.innerHeight - 4, bounds.bottom + 6) - top) };
      setRect(previous => previous && Object.keys(next).every(key => previous[key as keyof Rect] === next[key as keyof Rect]) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [open, step, cardHeight]);

  useEffect(() => {
    if (!open || !cardRef.current) return;
    const observer = new ResizeObserver(entries => {
      const measuredHeight = entries[0].target.getBoundingClientRect().height;
      if (measuredHeight > 0) setCardHeight(measuredHeight);
    });
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onPause(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onPause]);

  if (!open || !step) return null;
  const width = Math.min(380, viewport.width - 24);
  const height = Math.min(cardHeight, viewport.height - 24);
  const rightFits = step.placement !== 'below' && rect && rect.left + rect.width + width + 24 <= viewport.width;
  const belowFits = rect && rect.top + rect.height + height + 24 <= viewport.height;
  const left = rightFits ? rect!.left + rect!.width + 12
    : Math.max(12, Math.min(rect?.left ?? (viewport.width - width) / 2, viewport.width - width - 12));
  const top = rightFits ? Math.max(12, Math.min(rect!.top, viewport.height - height - 12))
    : belowFits ? rect!.top + rect!.height + 12
    : rect && rect.top > height + 24 ? rect.top - height - 12 : Math.max(12, viewport.height - height - 12);
  const chapters = [...new Set(steps.map(item => item.chapter || '导览'))];

  return <>
    {step.placement === 'below' && <div aria-hidden="true" style={{ height: height + 24 }} />}
    <div className="pointer-events-none fixed inset-0 z-[10000]">
    {rect ? <>
      <div className="absolute inset-x-0 top-0 bg-black/30" style={{ height: rect.top }} />
      <div className="absolute left-0 bg-black/30" style={{ top: rect.top, width: rect.left, height: rect.height }} />
      <div className="absolute right-0 bg-black/30" style={{ top: rect.top, left: rect.left + rect.width, height: rect.height }} />
      <div className="absolute inset-x-0 bottom-0 bg-black/30" style={{ top: rect.top + rect.height }} />
      <div className="absolute border-2 border-[#141414]" style={rect} />
    </> : <div className="absolute inset-0 bg-black/30" />}
    <div ref={cardRef} role="dialog" aria-label="看板使用导览" className="pointer-events-auto fixed overflow-y-auto border-2 border-[#141414] bg-white p-4 text-[#141414] shadow-[3px_3px_0_#141414]"
      style={{ left, top, width, maxHeight: viewport.height - 24 }}>
      <div className="-mx-4 -mt-4 mb-4 flex items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] px-4 py-3 text-xs">
        <strong>{step.chapter || '导览'} · {currentIndex + 1}/{steps.length}</strong>
        <button type="button" onClick={onPause} className="border border-[#141414] bg-white px-2 py-1 font-bold hover:bg-[#E4E3E0]">暂停</button>
      </div>
      <h3 className="mb-3 text-base font-bold">{step.title}</h3>
      {missing ? <p className="mb-3 bg-[#F0EFEC] p-3 text-[13px] leading-6">{step.unavailable || '当前内容尚未加载，可等待数据返回或查看下一步骤。'}</p>
        : step.action && <p className="mb-3 text-sm font-bold leading-6">{step.action}</p>}
      <p className="text-[13px] leading-6 text-[#141414]/70">{step.body}</p>
      <label className="mt-4 block border-t border-[#141414]/20 pt-3 text-xs text-[#141414]/60">
        选择导览步骤
        <select aria-label="导览步骤" value={currentIndex} onChange={event => onSelect(Number(event.target.value))} className="mt-2 block w-full border border-[#141414] bg-white px-2 py-2 text-xs text-[#141414]">
          {chapters.map(chapter => <optgroup key={chapter} label={chapter}>{steps.map((item, index) => (item.chapter || '导览') === chapter
            ? <option key={item.target + index} value={index}>{index + 1}. {item.title}</option> : null)}</optgroup>)}
        </select>
      </label>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={onPrev} disabled={currentIndex === 0} className="border border-[#141414] px-3 py-2 text-xs disabled:opacity-40">上一步</button>
        <button type="button" onClick={currentIndex === steps.length - 1 ? onFinish : onNext} className="border border-[#141414] bg-[#141414] px-3 py-2 text-xs font-bold text-white">{currentIndex === steps.length - 1 ? '完成' : '下一步'}</button>
      </div>
    </div>
    </div>
  </>;
}
