import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export function readBrowserState<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null"); return valid(value) ? value : fallback; } catch { return fallback; }
}
export function writeBrowserState(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage unavailable: keep working in memory. */ }
}
export function removeBrowserState(key: string) {
  try { localStorage.removeItem(key); } catch { /* Storage unavailable. */ }
}
export function useBrowserState<T>(key: string | undefined, fallback: T, valid: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => key ? readBrowserState(key, fallback, valid) : fallback);
  const set = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setValue((previous) => {
      const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
      if (key) writeBrowserState(key, next);
      return next;
    });
  }, [key]);
  return [value, set];
}
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isString = (value: unknown): value is string => typeof value === "string";
export const isPoint = (v: unknown): v is { x: number; y: number } => !!v && typeof v === "object" && "x" in v && "y" in v && typeof v.x === "number" && typeof v.y === "number" && Number.isFinite(v.x) && Number.isFinite(v.y);
export const isSize = (v: unknown): v is { width: number; height: number } => !!v && typeof v === "object" && "width" in v && "height" in v && typeof v.width === "number" && typeof v.height === "number" && Number.isFinite(v.width) && Number.isFinite(v.height) && v.width > 0 && v.height > 0;
