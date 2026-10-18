import { formatDate, formatMoney, normalizePhone, periodTitle } from './format.ts';
import { payTarget } from './payments.ts';
import { payoutNet } from './schedule.ts';
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

/** Who a template goes to: everyone, only members who haven't paid, or the turn's recipient. */
export type TemplateAudience = 'all' | 'unpaid' | 'recipient';

export interface GroupTemplate {
  key: 'reminder' | 'payout' | 'custom';
  label: string;
  text: string;
  audience: TemplateAudience;
}

/** Ready-made messages for the circle's WhatsApp group. */
export function groupTemplates(circle: Circle, entry: TimelineEntry | undefined, unpaid: Member[]): GroupTemplate[] {
  const out: GroupTemplate[] = [];
  if (entry && entry.due > 0 && unpaid.length > 0) {
    const lines = [
      `⏰ تذكير بقسط جمعية "${circle.name}"`,
      `لسه قسطك ما وصلش: ${formatMoney(entry.due, circle.currency)} (${periodTitle(entry)})`,
      `الميعاد: ${formatDate(entry.date)}`,
    ];
    const insta = payTarget('instapay', circle.payInfo);
    const vf = payTarget('vodafone_cash', circle.payInfo);
    if (insta || vf) lines.push('', 'التحويل على:', ...(insta ? [`⚡ إنستاباي: ${insta}`] : []), ...(vf ? [`📱 فودافون كاش: ${vf}`] : []));
    lines.push('', 'وبعد الدفع ادخل التطبيق ودوس "دفعت" 🙏');
    out.push({ key: 'reminder', label: `تذكير اللي ما دفعوش (${unpaid.length})`, text: lines.join('\n'), audience: 'unpaid' });
  }
  if (entry?.period.kind === 'payout' && entry.recipient) {
    out.push({
      key: 'payout',
      label: `دور القبض: ${entry.recipient.name}`,
      text: [
        `🎉 مبروك يا ${entry.recipient.name} — دورك تقبض`,
        `هتقبض ${formatMoney(payoutNet(circle, entry.period), circle.currency)} يوم ${formatDate(entry.date)}.`,
        'ادخل التطبيق ودوس "حدد طريقة القبض" واختار هتستلم إزاي.',
      ].join('\n'),
      audience: 'recipient',
    });
  }
  out.push({ key: 'custom', label: 'رسالة لكل الأعضاء', text: `📢 جمعية "${circle.name}"\n`, audience: 'all' });
  return out;
}
