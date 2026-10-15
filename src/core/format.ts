import type { Circle, Member } from './types';

const LOCALE = 'ar-EG';

export function formatMoney(amount: number, currency = 'EGP'): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatNumber(n: number): string {
  try {
    return new Intl.NumberFormat(LOCALE).format(n);
  } catch {
    return String(n);
  }
}

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** "15 أكتوبر 2026" — stable across devices (no ICU calendar quirks). */
export function formatDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  const parts = [formatNumber(d), MONTHS[m - 1]];
  if (withYear) parts.push(formatNumber(y).replace(/[٬,]/g, ''));
  return parts.join(' ');
}

export function ordinalTurn(cycle: number): string {
  const ordinals = [
    'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس',
    'السابع', 'الثامن', 'التاسع', 'العاشر',
  ];
  return ordinals[cycle] ?? `رقم ${formatNumber(cycle + 1)}`;
}

/**
 * Normalizes a phone number to international digits for wa.me links.
 * Egyptian local numbers (01xxxxxxxxx) get the 20 country code.
 */
export function normalizePhone(raw: string, defaultCountryCode = '20'): string | null {
  // Arabic-Indic digits → ASCII, then keep digits and a leading +
  let digits = raw
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function whatsappUrl(phone: string | undefined, text: string): string {
  const normalized = phone ? normalizePhone(phone) : null;
  const encoded = encodeURIComponent(text);
  return normalized ? `https://wa.me/${normalized}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function reminderMessage(circle: Circle, member: Member, cycle: number, date: string): string {
  return [
    `السلام عليكم يا ${member.name} 👋`,
    `تذكير بقسط جمعية "${circle.name}" للدور ${ordinalTurn(cycle)}.`,
    `المبلغ: ${formatMoney(circle.installment, circle.currency)}`,
    `الميعاد: ${formatDate(date)}`,
    `شكرًا ليك 🌷`,
  ].join('\n');
}

export function groupSummaryMessage(
  circle: Circle,
  cycle: number,
  date: string,
  recipient: Member,
  unpaid: Member[],
): string {
  const lines = [
    `📌 جمعية "${circle.name}" — الدور ${ordinalTurn(cycle)}`,
    `القبض: ${recipient.name} — ${formatMoney(circle.installment * circle.members.length, circle.currency)}`,
    `الميعاد: ${formatDate(date)}`,
  ];
  if (unpaid.length === 0) {
    lines.push('✅ الكل دفع، شكرًا يا جماعة!');
  } else {
    lines.push('', `لسه ما دفعوش (${formatNumber(unpaid.length)}):`);
    unpaid.forEach((m) => lines.push(`• ${m.name}`));
  }
  return lines.join('\n');
}
