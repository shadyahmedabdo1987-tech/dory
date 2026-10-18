import type { Circle, Frequency, Member, TimelineEntry } from './types';

let LOCALE = 'ar-EG';
let english = false;

/** The app's display language for numbers, money and dates. */
export function setFormatLocale(lang: 'ar' | 'en') {
  english = lang === 'en';
  LOCALE = english ? 'en-US' : 'ar-EG';
}

export function formatNumber(n: number): string {
  try {
    return new Intl.NumberFormat(LOCALE).format(n);
  } catch {
    return String(n);
  }
}

export function formatMoney(amount: number, currency = 'EGP'): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthName(m: number): string {
  return (english ? MONTHS_EN : MONTHS)[m - 1];
}

/** "15 أكتوبر 2026" — independent of device ICU calendar settings. */
export function formatDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  const parts = [formatNumber(d), monthName(m)];
  if (withYear) parts.push(formatNumber(y).replace(/[٬,]/g, ''));
  return parts.join(' ');
}

export const FREQUENCY_LABEL: Record<Frequency, { every: string; unit: string; units: string }> = {
  weekly: { every: 'كل أسبوع', unit: 'أسبوع', units: 'أسابيع' },
  monthly: { every: 'كل شهر', unit: 'شهر', units: 'شهور' },
  quarterly: { every: 'كل ٣ شهور', unit: 'قسط ربع سنوي', units: 'أقساط ربع سنوية' },
  every4months: { every: 'كل ٤ شهور', unit: 'قسط كل ٤ شهور', units: 'أقساط كل ٤ شهور' },
};

export function ordinal(n: number): string {
  const words = [
    'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس',
    'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر',
  ];
  return words[n] ?? `رقم ${formatNumber(n + 1)}`;
}

export function periodTitle(entry: TimelineEntry): string {
  switch (entry.period.kind) {
    case 'skip':
      return 'تأجيل';
    case 'extra':
      return 'قسط إضافي';
    default:
      return entry.recipient ? `قبض ${entry.recipient.name}` : 'قبض';
  }
}

export function relativeDays(days: number): string {
  if (days === 0) return 'النهارده';
  if (days === 1) return 'بكرة';
  if (days === -1) return 'امبارح';
  if (days > 0) return `بعد ${formatNumber(days)} يوم`;
  return `من ${formatNumber(-days)} يوم`;
}

/** Converts Arabic-Indic digits to ASCII. */
export function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

export function parseAmount(text: string): number {
  const ascii = toAsciiDigits(text).replace(/[^\d.]/g, '');
  return ascii ? Number(ascii) : NaN;
}

/**
 * Normalizes a phone to international digits (used for WhatsApp links and
 * for matching a member's phone when they join). Egyptian local numbers
 * (01xxxxxxxxx) get the 20 country code.
 */
export function normalizePhone(raw: string, defaultCountryCode = '20'): string | null {
  let digits = toAsciiDigits(raw).replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1);
  digits = digits.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** InstaPay address like name@instapay (letters, digits, . _ -). */
export const INSTAPAY_ADDRESS = /^[A-Za-z0-9._-]{2,40}@[A-Za-z0-9.-]{2,30}$/;

/**
 * A member's payout account: a wallet/InstaPay mobile number (normalized to
 * digits) or an InstaPay address (lower-cased). Null if it's neither.
 */
export function normalizePayAccount(raw: string): string | null {
  const value = toAsciiDigits(raw).trim().replace(/\s+/g, '');
  if (!value) return null;
  if (value.includes('@')) return INSTAPAY_ADDRESS.test(value) ? value.toLowerCase() : null;
  return normalizePhone(value);
}

export function whatsappUrl(phone: string | undefined, text: string): string {
  const normalized = phone ? normalizePhone(phone) : null;
  const encoded = encodeURIComponent(text);
  return normalized ? `https://wa.me/${normalized}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function reminderMessage(circle: Circle, member: Member, entry: TimelineEntry): string {
  return [
    `السلام عليكم يا ${member.name} 👋`,
    `تذكير بقسط جمعية "${circle.name}"${entry.period.kind === 'extra' ? ' (قسط إضافي)' : ''}.`,
    `المبلغ: ${formatMoney(entry.due, circle.currency)}`,
    `الميعاد: ${formatDate(entry.date)}`,
    `تقدر تتابع حسابك وتبلّغ بالدفع من تطبيق دوري 📱`,
  ].join('\n');
}

/** Short and plain: just what the code is for, and the code. */
export function inviteMessage(circle: Pick<Circle, 'name' | 'inviteCode'>, _member?: Member): string {
  return `كود الدخول لجمعية "${circle.name}" على تطبيق دوري: \u2066${circle.inviteCode}\u2069`;
}

/** The invitation the organizer sends by SMS / WhatsApp. */
export function circleInviteMessage(circle: Pick<Circle, 'name' | 'inviteCode'>): string {
  return inviteMessage(circle);
}

/** The member's protection code (sign-in code), on its own. */
export function protectionCodeMessage(circleName: string, code: string): string {
  return `كود الحماية الخاص بيك في جمعية "${circleName}": \u2066${code.replace(/\D/g, '')}\u2069`;
}

/** Opens the SMS app with the message ready for one or more numbers. */
export function smsUrl(phones: string[], body: string, platform: 'ios' | 'android' | string): string {
  const list = phones.map((p) => (p.startsWith('20') ? `+${p}` : p));
  const text = encodeURIComponent(body);
  if (platform === 'ios') {
    return list.length > 1 ? `sms:/open?addresses=${list.join(',')}&body=${text}` : `sms:${list[0] ?? ''}&body=${text}`;
  }
  return `sms:${list.join(';')}?body=${text}`;
}

/** Short share text (any app) with the code on its own line. */
export function shareInviteMessage(circle: Circle): string {
  return [
    `انضم لجمعية "${circle.name}" على تطبيق دوري.`,
    `كود الجمعية 👇`,
    '```' + circle.inviteCode + '```',
    `افتح التطبيق، ودوس "انضم بكود"، واكتب الكود واسمك.`,
  ].join('\n');
}

const INVITE_CODE = '[A-HJ-NP-Z2-9]{6}';

/**
 * Finds an invite code in whatever the member pasted: the code alone, the
 * whole WhatsApp invite, or a join link. Returns null if there's none.
 */
export function extractInviteCode(text: string): string | null {
  const t = text.trim();
  const patterns = [
    new RegExp(`code=(${INVITE_CODE})(?![A-Z0-9])`, 'i'),
    new RegExp('`+\\s*(' + INVITE_CODE + ')\\s*`+'),
    new RegExp(`كود[^A-Za-z0-9]{0,30}(${INVITE_CODE})(?![A-Za-z0-9])`),
    new RegExp(`(?:^|[^A-Za-z0-9])(${INVITE_CODE})(?![A-Za-z0-9])`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return m[1].toUpperCase();
  }
  const bare = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return new RegExp(`^${INVITE_CODE}$`).test(bare) ? bare : null;
}

export function groupSummaryMessage(
  circle: Circle,
  entry: TimelineEntry,
  unpaid: Member[],
): string {
  const lines = [`📌 جمعية "${circle.name}" — ${periodTitle(entry)}`, `الميعاد: ${formatDate(entry.date)}`];
  if (entry.period.kind === 'payout') {
    lines.push(`القبض: ${formatMoney(entry.due * circle.members.length, circle.currency)}`);
  }
  if (unpaid.length === 0) lines.push('✅ الكل دفع، شكرًا يا جماعة!');
  else {
    lines.push('', `لسه ما دفعوش (${formatNumber(unpaid.length)}):`);
    unpaid.forEach((m) => lines.push(`• ${m.name}`));
  }
  return lines.join('\n');
}
