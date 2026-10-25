import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { extractInviteCode, FREQUENCY_LABEL, formatDate, formatMoney, formatNumber, normalizePayAccount, normalizePhone, MIN_PASSWORD } from '@/core';
import {
  addPendingJoin,
  AppError,
  isPhoneRegistered,
  memberIdForPhone,
  hasMyPassword,
  hasLoginCode,
  joinWithLoginCode,
  hasPasswordFlag,
  markPasswordSet,
  setMyPassword,
  joinCircle,
  cancelJoinRequest,
  ensureSignedIn,
  removePendingJoin,
  requestJoin,
  arabicError,
  errorCode,
  findCircleByCode,
  useJoinStatus,
  useMyCircles,
  usePendingJoins,
  type DirectoryEntry,
} from '@/data';
import { Badge, Button, Card, Field, Row, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { ensurePushToken } from '@/notifications';
import { SpinningLogo } from '@/ui/SpinningLogo';
import { colors, radius, space } from '@/ui/theme';
import { useAppSession } from '@/data/session';
import { readPrefsSync, writePrefs } from '@/ui/prefs';
import { KeyboardScreen } from '@/ui/KeyboardScreen';

/** The spinner shows at least this long so the screen doesn't flash. */
const MIN_LOADING_MS = 1500;
/** Never wait forever on a slow or dropped connection. */
const LOOKUP_TIMEOUT_MS = 20000;

function withTimeout<T>(p: Promise<T>, ms = LOOKUP_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new AppError('unavailable', 'النت بطيء أو مقطوع. اتأكد من الاتصال وجرّب تاني.')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Full-screen spinner that always offers a way back if it takes too long. */
function Loading({ onBack }: { onBack: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={styles.loadingRoot}>
      <SpinningLogo label="بنفتح الجمعية بتاعتك…" />
      {slow ? <Button label="رجوع" icon="arrow-forward" variant="secondary" onPress={onBack} /> : null}
    </View>
  );
}

type Phase = { kind: 'enter' } | { kind: 'loading' } | { kind: 'found'; circle: DirectoryEntry } | { kind: 'error'; message: string };

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const initial = extractInviteCode(params.code ?? '') ?? '';
  const [code, setCode] = useState(initial);
  const [phase, setPhase] = useState<Phase>(initial ? { kind: 'loading' } : { kind: 'enter' });
  const [uid, setUid] = useState<string>();
  const [sent, setSent] = useState<{ cid: string; circleName: string; name: string } | null>(null);

  const lookup = async (value: string) => {
    setPhase({ kind: 'loading' });
    const started = Date.now();
    try {
      // Reading a circle card needs a (silent, anonymous) sign-in.
      const circle = await withTimeout(
        (async () => {
          const user = await ensureSignedIn();
          setUid(user.uid);
          return findCircleByCode(value);
        })(),
      );
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_LOADING_MS - (Date.now() - started))));
      setPhase({ kind: 'found', circle });
    } catch (e) {
      await new Promise((r) => setTimeout(r, Math.max(0, 800 - (Date.now() - started))));
      setPhase({ kind: 'error', message: arabicError(e) });
    }
  };

  // Opened from an invite link with the code already in it.
  useEffect(() => {
    if (initial) lookup(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (sent && uid) return <WaitingForApproval {...sent} uid={uid} />;

  if (phase.kind === 'loading') return <Loading onBack={() => setPhase({ kind: 'enter' })} />;
  if (phase.kind === 'found' && uid) {
    return <FoundCircle circle={phase.circle} code={code} uid={uid} onSent={setSent} onBack={() => setPhase({ kind: 'enter' })} />;
  }
  return (
    <EnterCode
      code={code}
      setCode={setCode}
      error={phase.kind === 'error' ? phase.message : undefined}
      onSubmit={() => lookup(code)}
    />
  );
}

/** Step 1: the invite code the organizer sent (typed or pasted). */
function EnterCode({
  code,
  setCode,
  error,
  onSubmit,
}: {
  code: string;
  setCode: (c: string) => void;
  error?: string;
  onSubmit: () => void;
}) {
  const onChange = (t: string) => {
    const next = extractInviteCode(t) ?? t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(next);
    // The whole code is in: put the keyboard away so "افتح الجمعية" is in sight.
    if (next.length === 6) Keyboard.dismiss();
  };
  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    const found = extractInviteCode(text ?? '');
    if (found) setCode(found);
    else alert('مفيش كود في اللي نسخته', 'انسخ رسالة الدعوة أو كود الجمعية، وبعدين دوس "الصق الكود".');
  };
  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Ionicons name="key" size={44} color={colors.gold} />
          <Text variant="heading" color={colors.white} center>
            ادخل كود الدعوة
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.85)" center>
            الكود وصلك من صاحب الجمعية في رسالة. هتشوف الجمعية وتبعت طلب انضمام باسمك.
          </Text>
        </View>
        <Card>
          <Field
            label="كود الدعوة"
            value={code}
            onChangeText={onChange}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="مثلًا: K7QX2M"
            returnKeyType="go"
            onSubmitEditing={() => code.length >= 6 && onSubmit()}
            error={error}
            style={{ letterSpacing: 4, textAlign: 'center', fontSize: 22 }}
          />
          <Button label="الصق الكود" icon="clipboard-outline" variant="secondary" onPress={paste} />
          <Button label="افتح الجمعية" icon="arrow-back" disabled={code.length < 6} onPress={onSubmit} />
        </Card>
      </ScrollView>
    </KeyboardScreen>
  );
}

/** Step 2: the circle behind the code, with the join request. */
function FoundCircle({
  circle,
  code,
  uid,
  onSent,
  onBack,
}: {
  circle: DirectoryEntry;
  code: string;
  uid: string;
  onSent: (s: { cid: string; circleName: string; name: string }) => void;
  onBack: () => void;
}) {
  const { refs: liveRefs, error: refsError } = useMyCircles(uid);
  const pending = usePendingJoins();
  const [joining, setJoining] = useState(false);
  // Wait for "my circles" so the organizer (or an existing member) isn't offered to join again —
  // but never forever: after an error or a few seconds, go on without it.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 8000);
    return () => clearTimeout(t);
  }, []);
  const refs = liveRefs ?? (refsError || gaveUp ? [] : undefined);
  if (refs === undefined) return <Loading onBack={onBack} />;
  const state = refs.some((r) => r.id === circle.id)
    ? 'member'
    : pending.some((p) => p.cid === circle.id)
      ? 'waiting'
      : circle.open
        ? 'open'
        : 'closed';

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Row gap={space.sm}>
        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
        <Text variant="heading">الكود ده بتاع الجمعية دي</Text>
      </Row>
      {state === 'closed' ? (
        <Card>
          <Text weight="bold">{circle.name}</Text>
          <Text variant="caption">الجمعية دي مش بتستقبل أعضاء جدد. لو إنت عضو فيها، ادخل برقم موبايلك المسجّل.</Text>
          <Button label="أنا عضو — ادخل برقمي" icon="call-outline" onPress={() => setJoining(true)} />
          <Button label="رجوع" icon="arrow-forward" variant="secondary" onPress={onBack} />
        </Card>
      ) : (
        <CircleCard
          item={circle}
          state={state}
          onJoin={() => setJoining(true)}
          onOpen={() => {
            if (router.canDismiss()) router.dismissAll();
            router.push({ pathname: '/circle/[id]', params: { id: circle.id } });
          }}
        />
      )}
      <Button label="كود تاني" icon="key-outline" variant="ghost" onPress={onBack} />
      <JoinSheet
        circle={joining ? circle : null}
        code={code}
        allowNew={state !== 'closed'}
        uid={uid}
        onClose={() => setJoining(false)}
        onSent={(s) => {
          setJoining(false);
          onSent(s);
        }}
      />
    </ScrollView>
  );
}

function CircleCard({
  item,
  state,
  onJoin,
  onOpen,
}: {
  item: DirectoryEntry;
  state: 'open' | 'waiting' | 'member';
  onJoin: () => void;
  onOpen: () => void;
}) {
  const members = item.slots
    ? `${formatNumber(item.memberCount)} من ${formatNumber(item.slots)} عضو`
    : `${formatNumber(item.memberCount)} عضو`;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }} gap={space.sm}>
        <View style={{ flex: 1 }}>
          <Text weight="bold" style={{ fontSize: 18 }} numberOfLines={1}>
            {item.name}
          </Text>
          {item.adminName ? <Text variant="caption">صاحب الجمعية: {item.adminName}</Text> : null}
        </View>
        <View style={styles.amount}>
          <Text weight="bold" color={colors.primary}>
            {formatMoney(item.installment)}
          </Text>
          <Text variant="caption">{FREQUENCY_LABEL[item.frequency]?.every ?? ''}</Text>
        </View>
      </Row>
      <Row gap={space.md}>
        <Row gap={4}>
          <Ionicons name="people-outline" size={16} color={colors.muted} />
          <Text variant="caption">{members}</Text>
        </Row>
        {item.startDate ? (
          <Row gap={4}>
            <Ionicons name="calendar-outline" size={16} color={colors.muted} />
            <Text variant="caption">تبدأ {formatDate(item.startDate)}</Text>
          </Row>
        ) : null}
      </Row>
      {state === 'member' ? (
        <Button label="إنت في الجمعية دي — افتحها" icon="open-outline" variant="secondary" onPress={onOpen} />
      ) : state === 'waiting' ? (
        <Badge label="طلبك مستني موافقة صاحب الجمعية" tone="gold" />
      ) : (
        <Button label="ادخل الجمعية" icon="log-in-outline" onPress={onJoin} />
      )}
    </Card>
  );
}

/**
 * Entering a circle with its code. The mobile number is the member's key:
 * a number already in the circle signs straight back in to its row (same name,
 * turn and payments — no new request); a new number asks to join with a name.
 */
function JoinSheet({
  circle,
  code,
  allowNew,
  uid,
  onClose,
  onSent,
}: {
  circle: DirectoryEntry | null;
  code: string;
  allowNew: boolean;
  uid: string;
  onClose: () => void;
  onSent: (s: { cid: string; circleName: string; name: string }) => void;
}) {
  const { user } = useAppSession();
  const [withCode, setWithCode] = useState(false);
  const [step, setStep] = useState<'phone' | 'login' | 'setpw' | 'details' | 'firstcode'>('phone');
  const [phone, setPhone] = useState(() => readPrefsSync().myPhone ?? '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [fromCode, setFromCode] = useState(false);
  const [loginCode, setLoginCode] = useState('');
  const [name, setName] = useState(user?.displayName ?? '');
  const { busy, run } = useAction();
  const phoneOk = !!normalizePhone(phone);
  const passwordShort = !!password && password.length < MIN_PASSWORD;
  const mismatch = !!password2 && password2 !== password;

  useEffect(() => {
    if (circle) {
      setStep('phone');
      setPassword('');
      setPassword2('');
    }
  }, [circle?.id]);

  const open = (cid: string) => {
    if (router.canDismiss()) router.dismissAll();
    router.push({ pathname: '/circle/[id]', params: { id: cid } });
  };

  // Step 1: is this number already a member here? → sign in with the password; otherwise register.
  const next = () =>
    circle &&
    run(async () => {
      if (await isPhoneRegistered(circle.id, phone)) {
        await ensurePushToken().catch(() => null);
        // The organizer gave this number a sign-in code: ask for the code first.
        const mid = await memberIdForPhone(circle.id, phone).catch(() => null);
        // …unless they already used it and chose a password: then it's the password.
        if (mid && (await hasLoginCode(circle.id, mid)) && !(await hasPasswordFlag(circle.id, mid))) {
          setPassword('');
          setWithCode(true);
          return setStep('login');
        }
        setWithCode(false);
        // Try the number alone: it only works while that member has no password yet
        // (e.g. the admin added them) — then they're linked and choose one now.
        try {
          await joinCircle(code, phone, (await ensureSignedIn()).uid);
        } catch (e) {
          if (errorCode(e) !== 'dory/signin-failed') throw e;
          setPassword('');
          return setStep('login');
        }
        setPassword('');
        setPassword2('');
        return setStep('setpw');
      }
      if (!allowNew) throw new AppError('dory/phone-not-found', arabicError({ code: 'dory/phone-not-found' }));
      setStep('details');
    });

  // Registered member: number + password → straight back in, same name and turn.
  const login = () =>
    circle &&
    run(async () => {
      await ensurePushToken().catch(() => null);
      // Always the account signed in right now (it changes after signing out).
      const me = (await ensureSignedIn()).uid;
      if (withCode) {
        // The organizer's code (checked against its fingerprint), then a password of their own.
        await joinWithLoginCode(code, phone, me, password);
        writePrefs({ myPhone: phone.trim(), myInstapay: phone.trim() });
        setFromCode(true);
        setPassword('');
        setPassword2('');
        return setStep('setpw');
      }
      const used = password;
      try {
        await joinCircle(code, phone, me, password);
      } catch (e) {
        if (errorCode(e) !== 'dory/signin-failed') throw e;
        // A sign-out from another phone may still be landing — try once more.
        await new Promise((r) => setTimeout(r, 1500));
        await joinCircle(code, phone, me, password);
      }
      // First sign-in for a member who never chose a password: this one becomes theirs.
      const memberId = await memberIdForPhone(circle.id, phone).catch(() => null);
      if (memberId && !(await hasMyPassword(circle.id, memberId))) {
        await setMyPassword(circle.id, memberId, phone, used).catch(() => {});
      } else if (memberId) {
        await markPasswordSet(circle.id, memberId).catch(() => {});
      }
      writePrefs({ myPhone: phone.trim(), myInstapay: phone.trim() });
      alert('أهلًا بيك تاني ✓', 'دخلت باسمك ودورك المسجّلين في الجمعية.');
      open(circle.id);
    });

  // New member the organizer added: their one-time code + a password of their own, in one go.
  const firstSignIn = () =>
    circle &&
    run(async () => {
      if (password.length < MIN_PASSWORD || password !== password2) throw new AppError('auth/weak-password', arabicError({ code: 'auth/weak-password' }));
      await ensurePushToken().catch(() => null);
      const me = (await ensureSignedIn()).uid;
      try {
        await joinCircle(code, phone, me, loginCode.trim());
      } catch (e) {
        if (errorCode(e) === 'dory/signin-failed') {
          throw new AppError('dory/code-wrong', 'كود الدخول مش صح. اتأكد من الكود اللي وصلك من صاحب الجمعية، أو اطلب منه كود جديد.');
        }
        throw e;
      }
      const memberId = await memberIdForPhone(circle.id, phone);
      if (memberId) await setMyPassword(circle.id, memberId, phone, password);
      writePrefs({ myPhone: phone.trim(), myInstapay: phone.trim() });
      alert('أهلًا بيك ✓', 'دخلت الجمعية باسمك ودورك. المرة الجاية تدخل بالكود ورقمك والباسورد اللي اخترته.');
      open(circle.id);
    });

  // Number the admin registered: choose a password (twice) and get linked to the row.
  const choosePassword = () =>
    circle &&
    run(async () => {
      if (password.length < MIN_PASSWORD || password !== password2) throw new AppError('auth/weak-password', arabicError({ code: 'auth/weak-password' }));
      const memberId = await memberIdForPhone(circle.id, phone);
      if (!memberId) throw new AppError('dory/phone-not-found', arabicError({ code: 'dory/phone-not-found' }));
      await setMyPassword(circle.id, memberId, phone, password);
      writePrefs({ myPhone: phone.trim(), myInstapay: phone.trim() });
      alert('تم حفظ الباسورد ✓', 'بقيت مربوط بالجمعية باسمك ودورك. المرة الجاية تدخل بالكود ورقمك والباسورد ده.');
      open(circle.id);
    });

  // First time: name + password, and the admin approves.
  const submit = () =>
    circle &&
    run(async () => {
      if (password.length < MIN_PASSWORD || password !== password2) throw new AppError('auth/weak-password', arabicError({ code: 'auth/weak-password' }));
      // So the admin's approval reaches this phone as a notification.
      await ensurePushToken().catch(() => null);
      // The mobile number is also the InstaPay / Vodafone Cash number they get paid on.
      const result = await requestJoin(circle.id, { name, phone, password, payAccount: phone }, uid);
      writePrefs({ myPhone: phone.trim(), myInstapay: phone.trim() });
      if (result.joined) return open(circle.id);
      await addPendingJoin({ cid: circle.id, circleName: circle.name, name: name.trim() });
      onSent({ cid: circle.id, circleName: circle.name, name: name.trim() });
    });

  return (
    <Sheet visible={!!circle} title={circle ? `انضمام لـ "${circle.name}"` : ''} onClose={onClose}>
      <View style={{ flexShrink: 1 }}>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
          <Field
            label="رقم موبايلك (المتسجّل على إنستاباي أو فودافون كاش)"
            value={phone}
            onChangeText={(t) => {
              setPhone(t);
              if (step !== 'phone') setStep('phone');
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            maxLength={16}
            placeholder="01xxxxxxxxx"
            error={phone.trim() && !phoneOk ? 'اكتب رقم موبايل صحيح.' : undefined}
            hint="لو سجّلت قبل كده، اكتب نفس الرقم والباسورد وهتدخل باسمك القديم."
            style={{ textAlign: 'left', writingDirection: 'ltr' }}
          />
          {step === 'phone' ? (
            <Button label="متابعة" icon="arrow-back" loading={busy} disabled={!phoneOk} onPress={next} />
          ) : step === 'setpw' ? (
            <>
              <View style={styles.firstTime}>
                <Ionicons name="key-outline" size={18} color={colors.primary} />
                <Text variant="caption" color={colors.text} style={{ flex: 1 }}>
                  {fromCode
                    ? 'دخلت بكود الدخول ✓ دلوقتي اختار باسورد خاص بيك واكتبه مرتين — هو اللي هتدخل بيه بعد كده.'
                    : 'صاحب الجمعية مسجّلك بالرقم ده. اختار باسورد واكتبه مرتين، وهتدخل الجمعية باسمك ودورك على طول.'}
                </Text>
              </View>
              <Field
                label="اختار باسورد"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                error={passwordShort ? '٦ حروف أو أكتر' : undefined}
              />
              <Field
                label="اكتب الباسورد تاني"
                value={password2}
                onChangeText={setPassword2}
                secureTextEntry
                autoCapitalize="none"
                error={mismatch ? 'الباسورد مش زي اللي فوق' : undefined}
              />
              <Button
                label="حفظ ودخول"
                icon="checkmark-circle-outline"
                loading={busy}
                disabled={password.length < MIN_PASSWORD || password !== password2}
                onPress={choosePassword}
              />
            </>
          ) : step === 'firstcode' ? (
            <>
              <View style={styles.firstTime}>
                <Ionicons name="key-outline" size={18} color={colors.primary} />
                <Text variant="caption" color={colors.text} style={{ flex: 1 }}>
                  أول مرة تدخل: اكتب كود الدخول اللي وصلك من صاحب الجمعية على الواتساب، واختار باسورد جديد واكتبه مرتين.
                </Text>
              </View>
              <Field label="كود الدخول" value={loginCode} onChangeText={setLoginCode} keyboardType="number-pad" maxLength={6} />
              <Field
                label="الباسورد الجديد"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                error={passwordShort ? '٦ حروف أو أكتر' : undefined}
              />
              <Field
                label="اكتب الباسورد تاني"
                value={password2}
                onChangeText={setPassword2}
                secureTextEntry
                autoCapitalize="none"
                error={mismatch ? 'الباسورد مش زي اللي فوق' : undefined}
              />
              <Button
                label="حفظ ودخول"
                icon="checkmark-circle-outline"
                loading={busy}
                disabled={loginCode.trim().length !== 6 || password.length < MIN_PASSWORD || password !== password2}
                onPress={firstSignIn}
              />
              <Text variant="caption" center color={colors.primary} weight="bold" onPress={() => setStep('login')}>
                عندي باسورد بالفعل
              </Text>
            </>
          ) : step === 'login' ? (
            <>
              <View style={styles.firstTime}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.primary} />
                <Text variant="caption" color={colors.text} style={{ flex: 1 }}>
                  {withCode
                    ? 'اكتب كود الدخول اللي صاحب الجمعية بعتهولك (٦ أرقام). بعده هتختار باسورد بتاعك.'
                    : 'الرقم ده مسجّل في الجمعية. اكتب الباسورد بتاعك وهتدخل على طول.'}
                </Text>
              </View>
              {withCode ? (
                <Field
                  label="كود الدخول"
                  value={password}
                  onChangeText={(t) => {
                    const d = t.replace(/[^0-9٠-٩]/g, '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).slice(0, 6);
                    setPassword(d);
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="123456"
                  style={{ writingDirection: 'ltr', textAlign: 'center', letterSpacing: 6, fontSize: 22 }}
                />
              ) : (
                <Field label="الباسورد" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
              )}
              <Button
                label="دخول"
                icon="log-in-outline"
                loading={busy}
                disabled={withCode ? !/^\d{6}$/.test(password) : !password}
                onPress={login}
              />
              <Pressable
                onPress={() => {
                  setPassword('');
                  setWithCode((v) => !v);
                }}
                style={styles.codeSwitch}
              >
                <Ionicons name={withCode ? 'lock-closed-outline' : 'keypad-outline'} size={18} color={colors.primary} />
                <Text weight="bold" color={colors.primary}>
                  {withCode ? 'معايا باسورد — أدخل بيه' : 'معايا كود دخول من صاحب الجمعية'}
                </Text>
              </Pressable>
              <Text variant="caption" center>
                نسيت الباسورد؟ اطلب من صاحب الجمعية يفك الربط، وبعدها تدخل بالكود ورقمك وتختار باسورد جديد.
              </Text>
            </>
          ) : (
            <>
              <View style={styles.firstTime}>
                <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                <Text variant="caption" color={colors.text} style={{ flex: 1 }}>
                  أول مرة تدخل الجمعية دي. اكتب اسمك واختار باسورد، وصاحب الجمعية هيوافق على طلبك. بعد كده تدخل بالكود ورقمك والباسورد.
                </Text>
              </View>
              <Field
                label="اسمك"
                value={name}
                onChangeText={setName}
                maxLength={60}
                autoComplete="name"
                placeholder="الاسم اللي صاحب الجمعية هيشوفه"
              />
              <Field
                label="الباسورد"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                error={passwordShort ? '٦ حروف أو أكتر' : undefined}
              />
              <Field
                label="اكتب الباسورد تاني"
                value={password2}
                onChangeText={setPassword2}
                secureTextEntry
                autoCapitalize="none"
                error={mismatch ? 'الباسورد مش زي اللي فوق' : undefined}
              />
              <Button
                label="ابعت طلب الانضمام"
                icon="send"
                loading={busy}
                disabled={!name.trim() || !phoneOk || password.length < MIN_PASSWORD || password !== password2}
                onPress={submit}
              />
            </>
          )}
        </ScrollView>
      </View>
    </Sheet>
  );
}

/** Shown right after sending the request; moves on by itself once the admin approves. */
function WaitingForApproval({ cid, uid, circleName, name }: { cid: string; uid: string; circleName: string; name: string }) {
  const status = useJoinStatus(cid, uid);
  const { run } = useAction();

  useEffect(() => {
    if (status !== 'approved') return;
    removePendingJoin(cid);
    if (router.canDismiss()) router.dismissAll();
    router.push({ pathname: '/circle/[id]', params: { id: cid } });
  }, [status, cid]);

  const rejected = status === 'gone';
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <View style={[styles.hero, rejected && { backgroundColor: colors.danger }]}>
        <Ionicons name={rejected ? 'close-circle' : 'hourglass'} size={56} color={rejected ? colors.white : colors.gold} />
        <Text variant="heading" color={colors.white} center>
          {rejected ? 'صاحب الجمعية ما وافقش على الطلب' : 'طلبك وصل لصاحب الجمعية'}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.85)" center>
          {rejected
            ? 'تقدر تختار جمعية تانية.'
            : `أول ما يوافق على "${name}" هتدخل "${circleName}" على طول. تقدر تقفل الشاشة دي — هتلاقي الطلب في الصفحة الرئيسية.`}
        </Text>
      </View>
      <Card>
        {rejected ? (
          <Button
            label="رجوع"
            icon="arrow-forward"
            onPress={() => {
              removePendingJoin(cid);
              router.back();
            }}
          />
        ) : (
          <>
            <Button label="تمام" icon="checkmark" onPress={() => router.back()} />
            <Button
              label="إلغاء الطلب"
              icon="close"
              variant="ghost"
              onPress={async () => {
                if (!(await confirm('إلغاء الطلب؟', 'صاحب الجمعية مش هيشوف طلبك.', 'إلغاء الطلب', true))) return;
                run(async () => {
                  await cancelJoinRequest(cid, uid);
                  await removePendingJoin(cid);
                  router.back();
                });
              }}
            />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  codeSwitch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.sm },
  firstTime: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: space.md },
  loadingRoot: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  amount: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
});
