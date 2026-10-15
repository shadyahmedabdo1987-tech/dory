import { formatDate, formatMoney, normalizePhone, periodTitle } from './format.ts';
import { payTarget } from './payments.ts';
import type { Circle, Member, TimelineEntry } from './types';

const GROUP_LINK = /^https:\/\/chat\.whatsapp\.com\/(invite\/)?[A-Za-z0-9]{10,40}$/;

/** Accepts what people paste (spaces, missing https, trailing text) and returns a clean invite link. */
export function cleanGroupLink(raw: string): string | null {
  const match = raw.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})/);
  if (!match) return null;
  const link = `https://chat.whatsapp.com/${match[1]}`;
  return GROUP_LINK.test(link) ? link : null;
}

export function isGroupLink(value: string | undefined): boolean {
  return !!value && GROUP_LINK.test(value);
}

/** One number per line, international format — paste into WhatsApp's "add participants". */
export function memberNumbersText(members: Member[]): { text: string; count: number; missing: string[] } {
  const numbers: string[] = [];
  const missing: string[] = [];
  for (const m of members) {
    const phone = m.phone ? normalizePhone(m.phone) : null;
    if (phone) numbers.push(`+${phone}`);
    else missing.push(m.name);
  }
  return { text: [...new Set(numbers)].join('\n'), count: new Set(numbers).size, missing };
}

export function groupInviteMessage(circle: Circle, member: Member, link: string): string {
  return [`أهلًا يا ${member.name} 👋`, `ده لينك جروب جمعية "${circle.name}" على واتساب:`, link].join('\n');
}

export interface GroupTemplate {
  key: 'reminder' | 'collect' | 'payout' | 'custom';
  label: string;
  text: string;
}

/** Ready-made messages for the circle's WhatsApp group. */
export function groupTemplates(circle: Circle, entry: TimelineEntry | undefined, unpaid: Member[]): GroupTemplate[] {
  const out: GroupTemplate[] = [];
  if (entry && entry.due > 0) {
    const lines = [
      `⏰ تذكير — جمعية "${circle.name}"`,
      `قسط ${periodTitle(entry)}: ${formatMoney(entry.due, circle.currency)}`,
      `الميعاد: ${formatDate(entry.date)}`,
    ];
    const insta = payTarget('instapay', circle.payInfo);
    const vf = payTarget('vodafone_cash', circle.payInfo);
    if (insta || vf) lines.push('', 'التحويل على:', ...(insta ? [`⚡ إنستاباي: ${insta}`] : []), ...(vf ? [`📱 فودافون كاش: ${vf}`] : []));
    lines.push('', 'وبعد الدفع ادخلوا تطبيق دوري ودوسوا "دفعت" 🙏');
    out.push({ key: 'reminder', label: 'تذكير بالقسط', text: lines.join('\n') });

    out.push({
      key: 'collect',
      label: 'مين لسه ما دفعش',
      text:
        unpaid.length === 0
          ? `✅ جمعية "${circle.name}" — الكل دفع قسط ${periodTitle(entry)}، شكرًا يا جماعة!`
          : [`📌 جمعية "${circle.name}" — ${periodTitle(entry)}`, 'لسه ما دفعوش:', ...unpaid.map((m) => `• ${m.name}`)].join('\n'),
    });
  }
  if (entry?.period.kind === 'payout' && entry.recipient) {
    out.push({
      key: 'payout',
      label: 'دور القبض',
      text: `🎁 الدور ده على ${entry.recipient.name} — ${formatMoney(entry.due * circle.members.length, circle.currency)} يوم ${formatDate(entry.date)}. مبروك مقدمًا!`,
    });
  }
  out.push({ key: 'custom', label: 'رسالة حرة', text: `📢 جمعية "${circle.name}"\n` });
  return out;
}
