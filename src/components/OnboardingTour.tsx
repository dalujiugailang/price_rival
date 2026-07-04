import React, { useEffect, useMemo, useState } from 'react';

export interface TourStep {
  target: string;
  title: string;
  body: string;
  tab?: string;
}

interface Props {
  open: boolean;
  steps: TourStep[];
  currentIndex: number;
  onPause: () => void;
  onFinish: () => void;
  onNext: () => void;
  onPrev: () => void;
}

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const PADDING = 8;

export default function OnboardingTour({
  open,
  steps,
  currentIndex,
  onPause,
  onFinish,
  onNext,
  onPrev
}: Props) {
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const step = steps[currentIndex];
  const isLast = currentIndex >= steps.length - 1;

  useEffect(() => {
    if (!open || !step) return;

    let cancelled = false;
    const updateRect = () => {
      const element = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!element) {
        setRect(null);
        return;
      }

      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      window.setTimeout(() => {
        if (cancelled) return;
        const next = element.getBoundingClientRect();
        setRect({
          top: Math.max(8, next.top - PADDING),
          left: Math.max(8, next.left - PADDING),
          width: next.width + PADDING * 2,
          height: next.height + PADDING * 2
        });
      }, 260);
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [open, step]);

  const tooltipStyle = useMemo<React.CSSProperties>(() => {
    if (!rect) {
      return {
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)'
      };
    }

    const tooltipWidth = 340;
    const tooltipHeight = 190;
    const gap = 14;
    const canPlaceRight = rect.left + rect.width + tooltipWidth + gap < window.innerWidth;
    const canPlaceBelow = rect.top + rect.height + tooltipHeight + gap < window.innerHeight;

    if (canPlaceRight) {
      return {
        left: rect.left + rect.width + gap,
        top: Math.max(12, Math.min(rect.top, window.innerHeight - tooltipHeight - 12))
      };
    }

    if (canPlaceBelow) {
      return {
        left: Math.max(12, Math.min(rect.left, window.innerWidth - tooltipWidth - 12)),
        top: rect.top + rect.height + gap
      };
    }

    return {
      left: Math.max(12, Math.min(rect.left, window.innerWidth - tooltipWidth - 12)),
      top: Math.max(12, rect.top - tooltipHeight - gap)
    };
  }, [rect]);

  if (!open || !step) return null;

  const topHeight = rect ? rect.top : 0;
  const leftWidth = rect ? rect.left : 0;
  const rightLeft = rect ? rect.left + rect.width : 0;
  const bottomTop = rect ? rect.top + rect.height : 0;

  return (
    <div className="fixed inset-0 z-[10000] pointer-events-none">
      {rect ? (
        <>
          <div className="absolute left-0 top-0 w-full bg-black/55" style={{ height: topHeight }} />
          <div className="absolute left-0 bg-black/55" style={{ top: rect.top, width: leftWidth, height: rect.height }} />
          <div className="absolute right-0 bg-black/55" style={{ top: rect.top, left: rightLeft, height: rect.height }} />
          <div className="absolute left-0 bottom-0 w-full bg-black/55" style={{ top: bottomTop }} />
          <div
            className="absolute border-[3px] border-[#2563eb] bg-white/10 shadow-[0_0_0_4px_rgba(37,99,235,0.25)]"
            style={rect}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        className="pointer-events-auto fixed w-[340px] border-2 border-[#141414] bg-white p-4 text-[#141414] shadow-[5px_5px_0_#141414]"
        style={tooltipStyle}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="bg-[#141414] px-2 py-0.5 text-[11px] font-black text-white">
            {currentIndex + 1}/{steps.length}
          </span>
          <button
            type="button"
            onClick={onPause}
            className="border border-[#141414] px-2 py-0.5 text-[11px] font-black hover:bg-[#141414] hover:text-white"
          >
            暂停
          </button>
        </div>
        <h3 className="mb-2 text-base font-black">{step.title}</h3>
        <p className="text-sm font-bold leading-relaxed text-[#141414]/75">{step.body}</p>
        {!rect && (
          <div className="mt-2 border border-[#141414]/30 bg-[#F0EFEC] px-2 py-1 text-[11px] font-bold">
            当前步骤目标未显示，继续下一步或返回上一页重试。
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="border border-[#141414] px-3 py-1.5 text-xs font-black disabled:opacity-40"
          >
            上一步
          </button>
          <button
            type="button"
            onClick={isLast ? onFinish : onNext}
            className="border border-[#141414] bg-[#141414] px-3 py-1.5 text-xs font-black text-white hover:bg-[#2A2A2B]"
          >
            {isLast ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
