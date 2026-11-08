// Stand-in for next/navigation backed by an in-memory history. The desktop app
// has no file routing; its view switching (App state) will drive these paths in
// the chat-shell migration. Copied web components call useRouter/usePathname/
// useSearchParams through this module via the "@/" alias rewrite.
import { useSyncExternalStore } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
const history: string[] = ['/'];
const state = { path: '/', search: '' };

function split(target: string) {
  const index = target.indexOf('?');
  return {
    path: index === -1 ? target : target.slice(0, index),
    search: index === -1 ? '' : target.slice(index + 1),
  };
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function navigate(target: string, options?: { replace?: boolean }) {
  const next = split(target);
  if (options?.replace) history[history.length - 1] = target;
  else history.push(target);
  state.path = next.path;
  state.search = next.search;
  emit();
}

export function back() {
  if (history.length > 1) {
    history.pop();
    const previous = split(history[history.length - 1]);
    state.path = previous.path;
    state.search = previous.search;
    emit();
  }
}

export function usePathname() {
  return useSyncExternalStore(
    subscribe,
    () => state.path,
    () => state.path,
  );
}

let cachedSearch = '';
let cachedParams = new URLSearchParams();

export function useSearchParams() {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (state.search !== cachedSearch) {
        cachedSearch = state.search;
        cachedParams = new URLSearchParams(state.search);
      }
      return cachedParams;
    },
    () => cachedParams,
  );
}

export function useRouter() {
  return {
    push: (target: string) => navigate(target),
    replace: (target: string) => navigate(target, { replace: true }),
    refresh: () => emit(),
    back,
    forward: () => {},
    prefetch: () => {},
  };
}
