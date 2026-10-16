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
  type Payment,
} from '@/core';
import { deleteAnnouncement, postAnnouncement, useAnnouncements } from '@/data';
import { Badge, Button, Card, Chip, Field, IconButton, Row, Text } from '@/ui/components';
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

// ---------------------------------------------------------------------------
// Member: announcements + group button
// ---------------------------------------------------------------------------

export function AnnouncementsCard({ circle }: { circle: Circle }) {
  const items = useAnnouncements(circle.id);
  const { unread, seenAt, markSeen } = useUnreadAnnouncements(circle.id, items);
  const [all, setAll] = useState(false);

  if (items.length === 0) return null;

  const allSheet = (
    <Sheet visible={all} title="إعلانات الجمعية" onClose={() => setAll(false)}>
      <ScrollView contentContainerStyle={{ gap: space.sm }}>
        {items.map((a) => (
          <AnnouncementRow key={a.id} item={a} isNew={false} />
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
        <AnnouncementRow key={a.id} item={a} isNew={!seenAt || a.createdAt > seenAt} />
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
      <Text variant="caption">{formatDate(item.createdAt.slice(0, 10))}</Text>
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

  const templates = useMemo(() => {
    const entries = timeline(circle);
    const i = Math.max(0, Math.min(currentIndex(circle) < 0 ? 0 : currentIndex(circle), entries.length - 1));
    const entry = entries[i];
    const unpaid = entry ? [...periodSummary(circle, payments, i).unpaid, ...periodSummary(circle, payments, i).claimed] : [];
    return groupTemplates(circle, entry, unpaid);
  }, [circle, payments]);

  const applyTemplate = (t: GroupTemplate) => {
    const [first, ...rest] = t.text.split('\n');
    setTitle(first.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 80) || t.label);
    setBody(rest.join('\n').trim());
  };

  const send = async () => {
    if (!title.trim()) return alert('اكتب عنوان', 'الإعلان محتاج عنوان قصير.');
    const sent = await run(async () => {
      await postAnnouncement(circle.id, uid, title, body);
      return true;
    });
    if (!sent) return;
    setTitle('');
    setBody('');
    alert('اتبعت لكل الأعضاء ✓', 'الإعلان ظهر عند كل الأعضاء جوه التطبيق.');
  };

  return (
    <View style={{ gap: space.md }}>
      <Card>
        <Row gap={space.sm}>
          <Ionicons name="notifications" size={20} color={colors.primary} />
          <Text variant="heading">إشعار لكل الأعضاء</Text>
        </Row>
        <Text variant="caption">بيظهر لكل عضو جوه التطبيق في "إعلانات الجمعية"، وبيوصل كإشعار على الموبايل.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {templates.map((t) => (
            <Chip key={t.key} label={t.label} active={false} onPress={() => applyTemplate(t)} />
          ))}
        </ScrollView>
        <Field label="العنوان" value={title} onChangeText={setTitle} maxLength={80} placeholder="مثلًا: تذكير بقسط الشهر" />
        <Field label="الرسالة" value={body} onChangeText={setBody} maxLength={1000} multiline style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: space.sm }} />
        <Button label="ابعت للأعضاء" icon="send" loading={busy} onPress={send} />
      </Card>

      {items.length > 0 && (
        <Card>
          <Text variant="heading">اللي اتبعت قبل كده</Text>
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
