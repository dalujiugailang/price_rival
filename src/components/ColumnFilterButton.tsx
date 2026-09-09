import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ColumnFilterButtonOption {
  value: string;
  label: string;
  count: number;
}

interface Props {
  label: string;
  options: ColumnFilterButtonOption[];
  activeValues: string[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onApply: (values: string[]) => void;
}

export default function ColumnFilterButton({
  label,
  options,
  activeValues,
  isOpen,
  onToggle,
  onClose,
  onApply
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [draftValues, setDraftValues] = useState<string[]>(activeValues);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setDraftValues(activeValues);
  }, [isOpen, activeValues]);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popupWidth = 300;
      const popupHeight = popupRef.current?.getBoundingClientRect().height || 420;
      setPosition({
        top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - popupHeight - 8)),
        left: Math.max(8, Math.min(rect.right - popupWidth, window.innerWidth - popupWidth - 8))
      });
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    updatePosition();
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, onClose]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleOptions = options.filter(option => (
    !normalizedSearch || option.label.toLocaleLowerCase().includes(normalizedSearch)
  ));
  const selectedSet = new Set(draftValues);
  const allVisibleSelected = visibleOptions.length > 0 && visibleOptions.every(option => selectedSet.has(option.value));

  const toggleValue = (value: string) => {
    setDraftValues(current => (
      current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value]
    ));
  };

  const toggleVisible = () => {
    const visibleValues = new Set(visibleOptions.map(option => option.value));
    setDraftValues(current => {
      if (allVisibleSelected) return current.filter(value => !visibleValues.has(value));
      return Array.from(new Set([...current, ...visibleValues]));
    });
  };

  const applyDraft = () => {
    const nextValues = draftValues.length === options.length ? [] : draftValues;
    onApply(nextValues);
    onClose();
  };

  const popup = isOpen ? createPortal((
    <div
      ref={popupRef}
      role="dialog"
      aria-label={`${label}筛选`}
      className="fixed z-[9999] w-[300px] border border-[#141414] bg-white p-2 text-left shadow-[3px_3px_0_#141414]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-black">
        <span className="truncate" title={label}>{label}</span>
        <span className="shrink-0 text-[#141414]/60">已选 {draftValues.length}</span>
      </div>
      <input
        autoFocus
        type="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder="搜索此列"
        className="mb-2 h-7 w-full border border-[#141414] bg-white px-2 text-[11px] font-bold outline-none focus:ring-2 focus:ring-[#141414]/20"
      />
      <button
        type="button"
        onClick={toggleVisible}
        className="mb-1 flex w-full items-center gap-2 border border-[#141414]/30 bg-[#F0EFEC] px-2 py-1.5 text-left text-[10px] font-black hover:bg-[#E4E3E0]"
      >
        <span className="flex h-3.5 w-3.5 items-center justify-center border border-[#141414] bg-white text-[9px]">
          {allVisibleSelected ? '✓' : ''}
        </span>
        {search ? '全选当前搜索结果' : '全选'}
        <span className="ml-auto text-[#141414]/60">{visibleOptions.length}项</span>
      </button>
      <div className="max-h-72 overflow-y-auto border border-[#141414]">
        {visibleOptions.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-[#141414]/50">没有匹配项</div>
        ) : visibleOptions.map(option => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2 border-b border-[#141414]/15 px-2 py-1.5 last:border-b-0 hover:bg-[#F9F9F8]"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(option.value)}
              onChange={() => toggleValue(option.value)}
              className="mt-0.5 h-3 w-3 shrink-0 accent-[#141414]"
            />
            <span className="min-w-0 flex-1 break-words text-[11px] font-bold leading-snug" title={option.label}>
              {option.label}
            </span>
            <span className="shrink-0 text-[9px] text-[#141414]/50">{option.count}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            onApply([]);
            onClose();
          }}
          className="border border-[#141414] px-2 py-1 text-[10px] font-bold hover:bg-[#E4E3E0]"
        >
          清除本列
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-[#141414] px-2 py-1 text-[10px] font-bold hover:bg-[#E4E3E0]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={applyDraft}
            className="border border-[#141414] bg-[#141414] px-2 py-1 text-[10px] font-bold text-white hover:bg-white hover:text-[#141414]"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  ), document.body) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={`筛选：${label}`}
        aria-label={`筛选${label}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={event => {
          event.stopPropagation();
          onToggle();
        }}
        className={`flex h-4 min-w-4 shrink-0 items-center justify-center border px-0.5 text-[9px] font-black leading-none ${
          activeValues.length > 0
            ? 'border-[#141414] bg-[#141414] text-white'
            : 'border-[#141414]/50 bg-white text-[#141414] hover:border-[#141414]'
        }`}
      >
        {activeValues.length > 0 ? activeValues.length : '▼'}
      </button>
      {popup}
    </>
  );
}
