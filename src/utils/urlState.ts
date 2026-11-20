import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';

const event = 'app:url-state';
let restoring = false;
if (typeof window !== 'undefined') {
  history.scrollRestoration = 'manual';
  window.addEventListener('scroll', () => {
    if (!restoring) history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
  }, { passive: true });
  window.addEventListener('popstate', () => {
    restoring = true;
    window.dispatchEvent(new Event(event));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo(0, history.state?.scrollY || 0);
      restoring = false;
    }));
  });
}
export function readRoute() {
  const params = new URLSearchParams(location.search);
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'channels' && parts.length >= 3) {
    params.set('channel', parts[1]); params.set('tab', parts[2]);
  }
  return params;
}
export function writeUrl(url: URL, replace = false) {
  if (url.href === location.href) return;
  history[replace ? 'replaceState' : 'pushState']({ scrollY: replace ? window.scrollY : 0 }, '', url);
  window.dispatchEvent(new Event(event));
}
export function useUrlState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const read = () => {
    const raw = new URLSearchParams(location.search).get(key);
    if (raw !== null) { try { return JSON.parse(raw) as T; } catch {} }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener(event, update);
    return () => window.removeEventListener(event, update);
  }, [key]);
  return [value, next => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(read()) : next;
    const url = new URL(location.href);
    url.searchParams.set(key, JSON.stringify(resolved));
    writeUrl(url);
    setValue(resolved);
  }];
}
export const routeEvent = event;
