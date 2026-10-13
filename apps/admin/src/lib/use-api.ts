'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { errorMessage } from './api/errors';
import { useToast } from './state/toast';

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (update: T | ((prev: T | undefined) => T)) => void;
}

/** Loads `path` (null = wait) and reloads when it changes. Keeps the previous data while the next page loads. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        if (!ctrl.signal.aborted) setDataState(d);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted && (e as Error)?.name !== 'AbortError') setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((u: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof u === 'function' ? (u as (p: T | undefined) => T)(prev) : u));
  }, []);
  return { data, error, loading, reload, setData };
}

/**
 * Runs a change against the API with a busy flag and a toast for the outcome.
 * Resolves with the result, or undefined when it failed (the error has been shown).
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);

  const run = useCallback(
    async <R>(key: string, fn: () => Promise<R>, success?: string | ((r: R) => string)): Promise<R | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = key;
      setBusy(key);
      try {
        const r = await fn();
        if (success) toast.success(typeof success === 'function' ? success(r) : success);
        // an empty success (HTTP 204) must not look like a failure to callers that check `!== undefined`
        return r === undefined ? (true as R) : r;
      } catch (e) {
        toast.error(errorMessage(e));
        return undefined;
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

/** A query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Mirrors list filters in the address bar, so a filtered view can be reloaded, bookmarked and shared. */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void, boolean] {
  const read = useCallback((): T => {
    if (typeof window === 'undefined') return defaults;
    const sp = new URLSearchParams(window.location.search);
    const out = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = sp.get(k);
      if (v !== null) (out as Record<string, string>)[k] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [state, setState] = useState<T>(defaults);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setState(read());
    setReady(true);
    const onPop = () => setState(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [read]);
  const update = useCallback(
    (patch: Partial<T>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(next)) if (v && v !== defaults[k]) sp.set(k, v);
        const s = sp.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
        return next;
      });
    },
    [defaults],
  );
  // `ready` turns true once the address bar has been read: load lists only then, so they are fetched once.
  return [state, update, ready];
}

/** A list the API pages with a cursor ({ items, nextCursor }): first page on load, more on request. */
export function useCursorList<T>(path: string | null) {
  const [items, setItems] = useState<T[] | undefined>(undefined);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const gen = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const my = ++gen.current;
    setLoading(true);
    setError(null);
    api<{ items: T[]; nextCursor: string | null }>(path)
      .then((d) => {
        if (gen.current !== my) return;
        setItems(d.items);
        setNext(d.nextCursor);
      })
      .catch((e: unknown) => gen.current === my && setError(e))
      .finally(() => gen.current === my && setLoading(false));
  }, [path, tick]);

  const loadMore = useCallback(async () => {
    if (!next || !path) return;
    const my = gen.current;
    setLoading(true);
    try {
      const d = await api<{ items: T[]; nextCursor: string | null }>(`${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(next)}`);
      if (gen.current !== my) return;
      setItems((prev) => [...(prev ?? []), ...d.items]);
      setNext(d.nextCursor);
    } catch (e) {
      if (gen.current === my) setError(e);
    } finally {
      if (gen.current === my) setLoading(false);
    }
  }, [next, path]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { items, hasMore: !!next, loading, error, loadMore, reload, setItems };
}
