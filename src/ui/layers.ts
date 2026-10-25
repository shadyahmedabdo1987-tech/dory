/**
 * iOS can't show a second native modal on top of an open one (the dialog never
 * appears and the screen looks frozen). So on iOS, while a sheet is open, dialogs
 * and the busy overlay are drawn inside the top-most sheet instead of as their own modal.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export const inlineLayers = Platform.OS === 'ios';

let stack: number[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function useStack() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return stack;
}

/** A sheet registers while it's open; returns true when it's the top-most one. */
export function useSheetLayer(open: boolean): boolean {
  const id = useRef(0);
  if (!id.current) id.current = nextId++;
  const s = useStack();
  useEffect(() => {
    if (!inlineLayers || !open) return;
    const me = id.current;
    stack = [...stack, me];
    emit();
    return () => {
      stack = stack.filter((x) => x !== me);
      emit();
    };
  }, [open]);
  return inlineLayers && open && s[s.length - 1] === id.current;
}

/**
 * True when no sheet is open (the root hosts draw the dialogs). On iOS it waits
 * for the last sheet's closing slide to finish before another modal can show.
 */
export function useNoSheetOpen(): boolean {
  const s = useStack();
  const empty = s.length === 0;
  const [settled, setSettled] = useState(empty);
  useEffect(() => {
    if (!inlineLayers) return;
    if (!empty) return setSettled(false);
    const t = setTimeout(() => setSettled(true), 450);
    return () => clearTimeout(t);
  }, [empty]);
  return !inlineLayers || (empty && settled);
}
