import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import {
  currentIndex,
  formatDate,
  formatNumber,
  groupInviteMessage,
  groupTemplates,
  memberNumbersText,
  periodSummary,
  timeline,
  whatsappUrl,
  type Announcement,
  type Circle,
  type GroupTemplate,
  type Payment,
} from '@/core';
import { deleteAnnouncement, postAnnouncement, updateWhatsappGroup, useAnnouncements } from '@/data';
import { Badge, Button, Card, Chip, Field, IconButton, Row, Text } from '@/ui/components';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';
import { alert } from '@/ui/dialog';

/** Opens WhatsApp with the text ready; the user picks the group/chat and taps send. */
export async function openWhatsAppText(text: string) {
  const encoded = encodeURIComponent(text);
  try {
    await Linking.openURL(`whatsapp://send?text=${encoded}`);
  } catch {
    try {
      await Linking.openURL(whatsappUrl(undefined, text));
    } catch {
      await Share.share({ message: text }).catch(() => {});
    }
  }
}

async function openUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    alert('واتساب مش متاح', 'اتأكد إن واتساب متسطّب على الموبايل.');
  }
}

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

  if (items.length === 0 && !circle.whatsappGroup) return null;
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
        {items.length > 0 && (
          <Button
            label={items.length > 2 ? `كل الإعلانات (${formatNumber(items.length)})` : 'تمام، قريتها'}
            icon={items.length > 2 ? 'list-outline' : 'checkmark'}
            variant="ghost"
            style={{ flex: 1 }}
            onPress={() => {
              markSeen();
              if (items.length > 2) setAll(true);
            }}
          />
        )}
        {circle.whatsappGroup ? (
          <Button label="جروب الجمعية" icon="logo-whatsapp" variant="whatsapp" style={{ flex: 1 }} onPress={() => openUrl(circle.whatsappGroup!)} />
        ) : null}
      </Row>

      <Sheet visible={all} title="إعلانات الجمعية" onClose={() => setAll(false)}>
        <ScrollView contentContainerStyle={{ gap: space.sm }}>
          {items.map((a) => (
            <AnnouncementRow key={a.id} item={a} isNew={false} />
          ))}
        </ScrollView>
      </Sheet>
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
// Admin: messages tab (announcements + WhatsApp group)
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
    const text = [title.trim(), body.trim()].filter(Boolean).join('\n');
    setTitle('');
    setBody('');
    alert('اتبعت لكل الأعضاء ✓', 'تحب تبعته كمان على جروب الواتساب؟', [
      { text: 'لأ', style: 'cancel' },
      { text: 'ابعت للجروب', icon: 'logo-whatsapp', color: colors.whatsapp, onPress: () => openWhatsAppText(`📢 ${text}`) },
    ]);
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
        <Row gap={space.sm}>
          <Button
            label="للجروب"
            icon="logo-whatsapp"
            variant="secondary"
            style={{ flex: 1 }}
            disabled={!title.trim() && !body.trim()}
            onPress={() => openWhatsAppText([title.trim(), body.trim()].filter(Boolean).join('\n'))}
          />
          <Button label="ابعت للأعضاء" icon="send" style={{ flex: 2 }} loading={busy} onPress={send} />
        </Row>
      </Card>

      <WhatsAppGroupCard circle={circle} />

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

// ---------------------------------------------------------------------------
// Admin: WhatsApp group setup
// ---------------------------------------------------------------------------

export function WhatsAppGroupCard({ circle }: { circle: Circle }) {
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState(circle.whatsappGroup ?? '');
  const [inviting, setInviting] = useState(false);
  const { busy, run } = useAction();
  const numbers = memberNumbersText(circle.members);
  const withPhone = circle.members.filter((m) => m.phone);

  const copyNumbers = async () => {
    await Clipboard.setStringAsync(numbers.text).catch(() => {});
    alert(
      `اتنسخ ${formatNumber(numbers.count)} رقم ✓`,
      numbers.missing.length ? `مفيش رقم لـ: ${numbers.missing.join('، ')}` : 'الصقهم وإنت بتضيف أعضاء الجروب.',
    );
  };

  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name="logo-whatsapp" size={22} color={colors.whatsapp} />
        <Text variant="heading" style={{ flex: 1 }}>
          جروب الواتساب
        </Text>
        {circle.whatsappGroup ? <Badge label="متوصل" tone="success" /> : null}
      </Row>

      {circle.whatsappGroup ? (
        <>
          <Text variant="caption">الأعضاء بيشوفوا زرار "جروب الجمعية" في حسابهم.</Text>
          <Row gap={space.sm}>
            <Button label="افتح الجروب" icon="open-outline" variant="whatsapp" style={{ flex: 1 }} onPress={() => openUrl(circle.whatsappGroup!)} />
            <Button label="ابعت اللينك للأعضاء" icon="people-outline" variant="secondary" style={{ flex: 1 }} onPress={() => setInviting(true)} />
          </Row>
          <Button label="تغيير اللينك" icon="create-outline" variant="ghost" onPress={() => setEditing(true)} />
        </>
      ) : (
        <>
          <View style={styles.steps}>
            <Step n={1} text="اعمل جروب جديد في واتساب." />
            <Step n={2} text={`انسخ أرقام الأعضاء (${formatNumber(numbers.count)}) وضيفهم.`} />
            <Step n={3} text='من إعدادات الجروب: "دعوة عن طريق رابط"، وانسخ اللينك هنا.' />
          </View>
          <Row gap={space.sm}>
            <Button label="افتح واتساب" icon="logo-whatsapp" variant="whatsapp" style={{ flex: 1 }} onPress={() => openUrl('whatsapp://')} />
            <Button label="انسخ الأرقام" icon="copy-outline" variant="secondary" style={{ flex: 1 }} onPress={copyNumbers} />
          </Row>
          <Button label="حط لينك الجروب" icon="link-outline" onPress={() => setEditing(true)} />
        </>
      )}

      <Sheet visible={editing} title="لينك جروب الواتساب" onClose={() => setEditing(false)}>
        <Field
          label="لينك الدعوة"
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://chat.whatsapp.com/…"
        />
        <Button
          label="لصق من الحافظة"
          icon="clipboard-outline"
          variant="ghost"
          onPress={async () => setLink((await Clipboard.getStringAsync().catch(() => '')) || link)}
        />
        <Row gap={space.sm}>
          {circle.whatsappGroup ? (
            <Button
              label="فك الربط"
              variant="danger"
              style={{ flex: 1 }}
              onPress={() =>
                run(async () => {
                  await updateWhatsappGroup(circle.id, null);
                  setEditing(false);
                })
              }
            />
          ) : null}
          <Button
            label="حفظ"
            icon="checkmark"
            style={{ flex: 2 }}
            loading={busy}
            onPress={() =>
              run(async () => {
                await updateWhatsappGroup(circle.id, link);
                setEditing(false);
              })
            }
          />
        </Row>
      </Sheet>

      <Sheet visible={inviting} title="ابعت لينك الجروب" onClose={() => setInviting(false)}>
        <Text variant="caption">دوس على كل عضو، هيفتح واتساب والرسالة جاهزة.</Text>
        <ScrollView style={{ maxHeight: 380 }}>
          {withPhone.map((m) => (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.inviteRow, pressed && { opacity: 0.6 }]}
              onPress={() => openUrl(whatsappUrl(m.phone, groupInviteMessage(circle, m, circle.whatsappGroup ?? '')))}
            >
              <Ionicons name="person-circle-outline" size={24} color={colors.primary} />
              <Text style={{ flex: 1 }}>{m.name}</Text>
              <Ionicons name="logo-whatsapp" size={20} color={colors.whatsapp} />
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </Card>
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
