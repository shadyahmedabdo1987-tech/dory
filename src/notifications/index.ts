import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import {
  planReminders,
  REMINDER_HOUR,
  reminderPrefix,
  type Circle,
  type Payment,
} from '@/core';
import { firestore } from '@/data/firebase';
import { saveCirclePushToken, setMyPushToken } from '@/data/push';

/**
 * Two kinds of notifications:
 *  1. Local reminders (installment tomorrow / today, payout day, collection day)
 *     scheduled on the device itself — free, work offline, no server needed.
 *  2. Push notifications sent device-to-device through Expo's push service
 *     (src/data/push.ts): announcements, "I paid", confirmations, join
 *     requests, payouts — shown on the lock screen even with the app closed.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const DEVICE_ID_KEY = 'dory/device-id';

async function deviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Platform.OS}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'تذكير الأقساط',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#C9A23F',
  });
  await Notifications.setNotificationChannelAsync('announcements', {
    name: 'إعلانات الجمعية',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#C9A23F',
  });
  await Notifications.setNotificationChannelAsync('payments', {
    name: 'الدفع والتأكيد',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#0F5C4D',
  });
}

/** Asks for permission once; returns whether notifications are allowed. */
export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Registers this device for push and stores the token under users/{uid}/devices.
 * Silently skips where push isn't available (simulators, Expo Go on Android,
 * builds without an EAS project id) — local reminders still work there.
 */
export async function registerForPush(uid: string): Promise<void> {
  try {
    const token = await ensurePushToken();
    if (!token) return;
    await setDoc(doc(firestore(), 'users', uid, 'devices', await deviceId()), {
      token,
      platform: Platform.OS,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Push registration skipped', e);
  }
}

let tokenPromise: Promise<string | null> | undefined;

/**
 * This device's Expo push token (asks for permission once). Null where push
 * isn't available (simulator, no EAS project id in the build).
 */
export function ensurePushToken(): Promise<string | null> {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      try {
        if (!(await ensurePermission()) || !Device.isDevice) return null;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) return null;
        const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
        setMyPushToken(data);
        return data;
      } catch (e) {
        console.warn('Push token unavailable', e);
        tokenPromise = undefined; // try again next time
        return null;
      }
    })();
  }
  return tokenPromise;
}

/** Saves this device's token in a circle so its notifications reach the screen even when the app is closed. */
export function useCirclePush(cid: string | undefined, uid: string | undefined) {
  useEffect(() => {
    if (!cid || !uid) return;
    ensurePushToken().then((t) => t && saveCirclePushToken(cid, uid));
  }, [cid, uid]);
}

/** Removes this device's token (call before signing out). */
export async function unregisterPush(uid: string): Promise<void> {
  try {
    await deleteDoc(doc(firestore(), 'users', uid, 'devices', await deviceId()));
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Local reminders
// ---------------------------------------------------------------------------

async function syncReminders(
  circle: Circle,
  payments: Payment[],
  viewer: { role: 'admin' } | { role: 'member'; memberId: string },
) {
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return;
  const planned = planReminders(circle, payments, viewer);
  const prefix = reminderPrefix(circle.id);
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.identifier.startsWith(prefix));

  // Cancel what's no longer needed (paid, moved, postponed…)
  const wanted = new Set(planned.map((r) => r.id));
  await Promise.all(
    scheduled.filter((n) => !wanted.has(n.identifier)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  // (Re)schedule the rest. Scheduling with an existing identifier replaces it.
  for (const r of planned) {
    const [y, m, d] = r.date.split('-').map(Number);
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { circleId: r.circleId }, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(y, m - 1, d, REMINDER_HOUR, 0, 0),
        channelId: 'reminders',
      },
    });
  }
}

export async function clearReminders(circleId?: string) {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.identifier.startsWith(circleId ? reminderPrefix(circleId) : 'dory:'))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** Keeps this device's reminders for a circle in sync with live data. */
export function useCircleReminders(
  circle: Circle | undefined,
  payments: Payment[] | undefined,
  role: 'admin' | 'member' | 'none',
  memberId: string | undefined,
) {
  const lastKey = useRef('');
  useEffect(() => {
    if (Platform.OS === 'web' || !circle || !payments) return;
    if (role === 'none' || (role === 'member' && !memberId)) return;
    const viewer = role === 'admin' ? ({ role: 'admin' } as const) : ({ role: 'member', memberId: memberId! } as const);
    const key = JSON.stringify(planReminders(circle, payments, viewer));
    if (key === lastKey.current) return; // nothing changed
    lastKey.current = key;
    syncReminders(circle, payments, viewer).catch((e) => console.warn('Reminder sync failed', e));
  }, [circle, payments, role, memberId]);
}

/** Opens the right circle when a notification is tapped. */
export function useNotificationRouting() {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const circleId = response?.notification.request.content.data?.circleId;
    if (typeof circleId === 'string' && circleId) {
      router.push({ pathname: '/circle/[id]', params: { id: circleId } });
    }
  }, [response]);
}
