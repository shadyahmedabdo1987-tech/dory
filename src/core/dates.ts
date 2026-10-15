import type { Frequency } from './types';

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export function parseISODate(iso: string): YMD {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Invalid date: ${iso}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid date: ${iso}`);
  return { y, m, d };
}

export function toISODate({ y, m, d }: YMD): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds months, clamping to month end (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseISODate(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISODate({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseISODate(iso);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toISODate({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export const FREQUENCY_MONTHS: Record<Frequency, number> = { weekly: 0, monthly: 1, quarterly: 3 };

/** Date of the n-th step (0-based) from the start date. */
export function stepDate(startDate: string, frequency: Frequency, step: number): string {
  return frequency === 'weekly'
    ? addDays(startDate, step * 7)
    : addMonths(startDate, step * FREQUENCY_MONTHS[frequency]);
}
