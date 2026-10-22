import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  currentIndex,
  formatDate,
  formatNumber,
  groupTemplates,
  periodSummary,
  timeline,
  type Announcement,
  type Circle,
  type GroupTemplate,
  type Member,
  type Payment,
  type TemplateAudience,
} from '@/core';
import { deleteAnnouncement, deleteInboxMessage, postAnnouncement, useAnnouncements, useMemberMessages } from '@/data';
import { Badge, Button, Card, Field, IconButton, Row, Text } from '@/ui/components';
import { MultiSelect, Select } from '@/ui/Select';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';
import { alert } from '@/ui/dialog';

// ---------------------------------------------------------------------------
// Unread tracking (per device, per circle)
// ---------------------------------------------------------------------------

const seenKey = (cid: string) => `dory/announcements-seen/${cid}`;

export function useUnreadAnnouncements(cid: string, items: Announcement[]) {
  const [seenAt, setSeenAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(seenKey(cid))
      .then((v) => setSeenAt(v))
      .catch(() => setSeenAt(null));
  }, [cid]);

  const unread = seenAt === undefined ? 0 : items.filter((a) => !seenAt || a.createdAt > seenAt).length;

  const markSeen = useCallback(() => {
    const latest = items[0]?.createdAt;
    if (!latest || (seenAt && seenAt >= latest)) return;
    setSeenAt(latest);
    AsyncStorage.setItem(seenKey(cid), latest).catch(() => {});
  }, [cid, items, seenAt]);

  return { unread, seenAt, markSeen };
}

const hiddenKey = (cid: string) => `dory/announcements-hidden/${cid}`;

/** Announcements a member removed from their own screen (they stay for everyone else). */
function useHiddenAnnouncements(cid: string) {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(hiddenKey(cid))
      .then((v) => setHidden(v ? (JSON.parse(v) as string[]) : []))
      .catch(() => setHidden([]));
  }, [cid]);
  const hide = useCallback(
    (id: string) =>
      setHidden((prev) => {
        const next = [...prev.filter((x) => x !== id), id].slice(-200);
        AsyncStorage.setItem(hiddenKey(cid), JSON.stringify(next)).catch(() => {});
        return next;
      }),
    [cid],
  );
  return { hidden, hide };
}

// ---------------------------------------------------------------------------
// Member: announcements + group button
// ---------------------------------------------------------------------------

export function AnnouncementsCard({ circle, memberId }: { circle: Circle; memberId: string }) {
  const everything = useMemberMessages(circle.id, memberId);
  const { hidden, hide } = useHiddenAnnouncements(circle.id);
  const items = useMemo(() => everything.filter((a) => !hidden.includes(a.id)), [everything, hidden]);
  const { unread, seenAt, markSeen } = useUnreadAnnouncements(circle.id, items);
  const [all, setAll] = useState(false);
  const { run } = useAction();

  const remove = async (a: Announcement) => {
    if (!(await confirm('مسح الرسالة؟', 'هتختفي من عندك إنت بس.', 'امسح', true))) return;
    if (a.private) run(() => deleteInboxMessage(circle.id, memberId, a.id));
    else hide(a.id);
  };

  if (items.length === 0) return null;

  const allSheet = (
    <Sheet visible={all} title="إعلانات الجمعية" onClose={() => setAll(false)}>
      <ScrollView contentContainerStyle={{ gap: space.sm }}>
        {items.map((a) => (
          <AnnouncementRow key={a.id} item={a} isNew={false} onDelete={() => remove(a)} />
        ))}
      </ScrollView>
    </Sheet>
  );

  // Everything read: just a slim row to reopen them.
  if (seenAt !== undefined && unread === 0) {
    return (
      <>
        <Pressable onPress={() => setAll(true)} style={({ pressed }) => [styles.compact, pressed && { opacity: 0.7 }]}>
          <Ionicons name="megaphone-outline" size={18} color={colors.gold} />
          <Text weight="semibold" style={{ flex: 1 }}>
            الإعلانات ({formatNumber(items.length)})
          </Text>
          <Ionicons name="chevron-back" size={18} color={colors.muted} />
        </Pressable>
        {allSheet}
      </>
    );
  }
  const latest = items.slice(0, 2);

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <Ionicons name="megaphone" size={20} color={colors.gold} />
          <Text variant="heading">إعلانات الجمعية</Text>
        </Row>
        {unread > 0 && <Badge label={`${formatNumber(unread)} جديد`} tone="gold" />}
      </Row>

      {latest.map((a) => (
        <AnnouncementRow key={a.id} item={a} isNew={!seenAt || a.createdAt > seenAt} onDelete={() => remove(a)} />
      ))}

      <Row gap={space.sm}>
        {items.length > 2 ? (
          <Button
            label={`كل الإعلانات (${formatNumber(items.length)})`}
            icon="list-outline"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={() => setAll(true)}
          />
        ) : null}
        <Button label="تمام، قريتها" icon="checkmark" variant="secondary" style={{ flex: 1 }} onPress={markSeen} />
      </Row>

      {allSheet}
    </Card>
  );
}

function AnnouncementRow({ item, isNew, onDelete }: { item: Announcement; isNew: boolean; onDelete?: () => void }) {
  return (
    <View style={[styles.announcement, isNew && styles.announcementNew]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text weight="bold" style={{ flex: 1 }}>
          {item.title}
        </Text>
        {onDelete ? <IconButton icon="trash-outline" label="مسح" color={colors.danger} bg="transparent" onPress={onDelete} /> : null}
      </Row>
      {item.body ? <Text>{item.body}</Text> : null}
      <Text variant="caption">
        {formatDate(item.createdAt.slice(0, 10))}
        {item.private ? ' • ليك إنت بس' : ''}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Admin: messages tab (announcements)
// ---------------------------------------------------------------------------

export function MessagesTab({ circle, payments, uid }: { circle: Circle; payments: Payment[]; uid: string }) {
  const items = useAnnouncements(circle.id);
  const { busy, run } = useAction();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<TemplateAudience | 'pick'>('all');
  // Private message: the members the organizer picked by name.
  const [picked, setPicked] = useState<string[]>([]);

  const { templates, unpaid, recipient } = useMemo(() => {
    const entries = timeline(circle);
    const i = Math.max(0, Math.min(currentIndex(circle) < 0 ? 0 : currentIndex(circle), entries.length - 1));
    const entry = entries[i];
    // Only members who really haven't paid (a claimed payment counts as paid until the admin rejects it).
    const unpaid: Member[] = entry ? periodSummary(circle, payments, i).unpaid : [];
    const recipient = entry?.period.kind === 'payout' ? entry.recipient : undefined;
    return { templates: groupTemplates(circle, entry, unpaid), unpaid, recipient };
  }, [circle, payments]);

  const targets: Member[] | null =
    audience === 'unpaid'
      ? unpaid
      : audience === 'recipient'
        ? recipient
          ? [recipient]
          : []
        : audience === 'pick'
          ? circle.members.filter((m) => picked.includes(m.id))
          : null;

  const applyTemplate = (t: GroupTemplate) => {
    const [first, ...rest] = t.text.split('\n');
    setTitle(first.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 80) || t.label);
    setBody(rest.join('\n').trim());
    setAudience(t.audience);
  };

  const send = async () => {
    if (!title.trim()) return alert('اكتب عنوان', 'الرسالة محتاجة عنوان قصير.');
    if (targets && targets.length === 0) {
      return alert(
        'مفيش حد يوصله',
        audience === 'pick' ? 'اختار عضو أو أكتر الأول.' : audience === 'unpaid' ? 'الكل دفع القسط ده ✓' : 'مفيش صاحب دور للفترة دي.',
      );
    }
    const sent = await run(async () => {
      await postAnnouncement(
        circle.id,
        uid,
        title,
        body,
        targets ? { memberIds: targets.map((m) => m.id), uids: targets.map((m) => m.uid) } : undefined,
      );
      return true;
    });
    if (!sent) return;
    setTitle('');
    setBody('');
    setAudience('all');
    setPicked([]);
    alert(
      'اتبعت ✓',
      targets ? `وصلت لـ: ${targets.map((m) => m.name).join('، ')} بس.` : 'الرسالة ظهرت عند كل الأعضاء جوه التطبيق.',
    );
  };

  const audienceOptions: { value: TemplateAudience; label: string }[] = [
    { value: 'all', label: 'كل الأعضاء' },
    { value: 'unpaid', label: `اللي ما دفعوش (${formatNumber(unpaid.length)})` },
    ...(recipient ? [{ value: 'recipient' as const, label: `صاحب الدور: ${recipient.name}` }] : []),
  ];
  const quick = [
    { label: 'أكّد استلام فلوسك', title: 'أكّد إنك استلمت فلوسك', body: 'لو القبض وصلك، افتح دوري ودوس "استلمت الفلوس ✓" علشان الجمعية تتقفل. شكرًا 🙏' },
    { label: 'ادفع القسط', title: 'تذكير بقسطك', body: 'قسطك لسه ما وصلش. ادفعه ودوس "دفعت" في التطبيق. شكرًا 🙏' },
    { label: 'افتح التطبيق', title: 'افتح دوري', body: 'في حاجة مستنياك في التطبيق، افتحه وشوفها. شكرًا 🙏' },
  ];

  return (
    <View style={{ gap: space.md }}>
      <Card>
        <Row gap={space.sm}>
          <Ionicons name="notifications" size={20} color={colors.primary} />
          <Text variant="heading">ابعت رسالة</Text>
        </Row>
        <Text variant="caption">بتظهر جوه التطبيق وبتوصل كإشعار على الموبايل — للي تختارهم بس.</Text>
        <Select
          label="رسالة جاهزة"
          value={null}
          placeholder="اختار رسالة جاهزة (اختياري)"
          onChange={(k) => {
            const t = templates.find((x) => x.key === k);
            if (t) applyTemplate(t);
          }}
          options={templates.map((t) => ({ value: t.key, label: t.label }))}
        />

        <Select
          label="هتوصل لمين؟"
          value={audience}
          onChange={setAudience}
          options={[
            ...audienceOptions.map((o) => ({ value: o.value as TemplateAudience | 'pick', label: o.label })),
            { value: 'pick' as const, label: 'رسالة خاصة لعضو', sub: 'تختار عضو أو أكتر بالاسم' },
          ]}
        />
        {audience === 'pick' ? (
          <View style={{ gap: space.sm }}>
            <Text variant="caption">اختار مين يوصله — محدش غيره هيشوفها.</Text>
            <MultiSelect
              values={picked}
              onChange={setPicked}
              placeholder="اختار الأعضاء…"
              title="هتوصل لمين؟"
              options={circle.members
                .filter((m) => m.id !== circle.ownerMemberId)
                .map((m) => ({ value: m.id, label: m.name, sub: m.uid ? undefined : 'لسه ما دخلش التطبيق' }))}
            />
            <Select
              value={null}
              placeholder="رسالة جاهزة (اختياري)"
              onChange={(label) => {
                const q = quick.find((x) => x.label === label);
                if (q) {
                  setTitle(q.title);
                  setBody(q.body);
                }
              }}
              options={quick.map((q) => ({ value: q.label, label: q.label }))}
            />
          </View>
        ) : null}
        {targets ? (
          <Text variant="caption" color={targets.length ? colors.primary : colors.danger}>
            {targets.length
              ? `هتوصل لـ: ${targets.map((m) => m.name).join('، ')}`
              : audience === 'pick'
                ? 'اختار عضو أو أكتر.'
                : audience === 'unpaid'
                  ? 'الكل دفع ✓ — مفيش حد تفكّره.'
                  : 'مفيش صاحب دور.'}
          </Text>
        ) : null}

        <Field label="العنوان" value={title} onChangeText={setTitle} maxLength={80} placeholder="مثلًا: تذكير بقسط الشهر" />
        <Field label="الرسالة" value={body} onChangeText={setBody} maxLength={1000} multiline style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: space.sm }} />
        <Button
          label={
            audience === 'all'
              ? 'ابعت لكل الأعضاء'
              : audience === 'unpaid'
                ? 'ابعت للي ما دفعوش'
                : audience === 'pick'
                  ? picked.length === 1
                    ? `ابعت لـ ${circle.members.find((m) => m.id === picked[0])?.name ?? ''}`
                    : 'ابعت رسالة خاصة'
                  : 'ابعت لصاحب الدور'
          }
          icon="send"
          loading={busy}
          onPress={send}
        />
      </Card>

      {items.length > 0 && (
        <Card>
          <Text variant="heading">اللي اتبعت لكل الأعضاء</Text>
          {items.map((a) => (
            <AnnouncementRow
              key={a.id}
              item={a}
              isNew={false}
              onDelete={async () => {
                if (await confirm('مسح الإعلان؟', 'هيختفي من عند كل الأعضاء.', 'امسح', true)) run(() => deleteAnnouncement(circle.id, a.id));
              }}
            />
          ))}
        </Card>
      )}
    </View>
  );
}


function Step({ n, text }: { n: number; text: string }) {
  return (
    <Row gap={space.sm}>
      <View style={styles.stepNum}>
        <Text variant="caption" weight="bold" color={colors.primary}>
          {formatNumber(n)}
        </Text>
      </View>
      <Text variant="caption" color={colors.text} style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  announcement: { backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md, gap: 4 },
  announcementNew: { backgroundColor: colors.goldSoft, borderWidth: 1, borderColor: colors.gold },
  audience: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  steps: { gap: space.sm, backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
