import type { ReactNode } from 'react';

import { setFormatLocale } from '@/core';
import { readPrefsSync, type Lang } from '@/ui/prefs';

import { EXACT, PATTERNS } from './en';

/**
 * Language support. The app is written in Arabic; in English mode every
 * piece of UI text is looked up in the dictionary (exact text, or a pattern
 * for text with names/numbers in it). Anything not found stays as it is.
 * Chosen in "حسابي" and applied when the app starts (layout direction too).
 */
export const lang: Lang = readPrefsSync().lang ?? 'ar';
export const isEn = lang === 'en';

if (isEn) setFormatLocale('en');

const ARABIC = /[؀-ۿ]/;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const compiled: { re: RegExp; order: number[]; en: string }[] = isEn
  ? PATTERNS.map(([ar, en]) => {
      const order: number[] = [];
      const source = ar
        .split(/(\{\d+\})/)
        .map((part) => {
          const m = part.match(/^\{(\d+)\}$/);
          if (m) {
            order.push(Number(m[1]));
            return '([\\s\\S]*?)';
          }
          return escapeRe(part);
        })
        .join('');
      return { re: new RegExp(`^${source}$`), order, en };
    })
  : [];

function lookup(s: string): string | undefined {
  const exact = EXACT[s];
  if (exact !== undefined) return exact;
  for (const p of compiled) {
    const m = s.match(p.re);
    if (!m) continue;
    const values: string[] = [];
    p.order.forEach((n, i) => (values[n] = m[i + 1] ?? ''));
    return p.en.replace(/\{(\d+)\}/g, (_, n) => tr(values[Number(n)] ?? ''));
  }
  return undefined;
}

/** Translate one piece of UI text (no-op in Arabic). */
export function tr(s: string): string;
export function tr(s: string | undefined): string | undefined;
export function tr(s: string | undefined): string | undefined {
  if (!isEn || !s || !ARABIC.test(s)) return s;
  const lead = s.match(/^\s*/)![0];
  const trail = s.match(/\s*$/)![0];
  const core = s.trim();
  const hit = lookup(core);
  if (hit !== undefined) return lead + hit + trail;
  // Multi-line text: translate line by line.
  if (core.includes('\n')) return lead + core.split('\n').map((l) => tr(l)).join('\n') + trail;
  // "A • B" / "A — B" pieces.
  for (const sep of [' • ', ' — ', '، ']) {
    if (core.includes(sep)) {
      const parts = core.split(sep).map((x) => tr(x));
      if (parts.some((x, i) => x !== core.split(sep)[i])) return lead + parts.join(sep === '، ' ? ', ' : sep) + trail;
    }
  }
  return s;
}

/** Translate Text children: a string, or several strings/numbers rendered together. */
export function trNode(children: ReactNode): ReactNode {
  if (!isEn) return children;
  if (typeof children === 'string') return tr(children);
  if (Array.isArray(children)) {
    const flat = children.flat(Infinity as 1);
    if (flat.every((c) => typeof c === 'string' || typeof c === 'number' || c == null || typeof c === 'boolean')) {
      return tr(flat.map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join(''));
    }
    return flat.map((c) => (typeof c === 'string' ? tr(c) : c));
  }
  return children;
}
