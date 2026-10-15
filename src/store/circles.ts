import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  markAllPaid,
  togglePaidOut,
  togglePayment,
  type Circle,
  type CircleDraft,
} from '@/core';

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

interface CirclesState {
  circles: Circle[];
  hydrated: boolean;
  createCircle: (draft: CircleDraft) => Circle;
  updateCircle: (id: string, draft: CircleDraft) => void;
  deleteCircle: (id: string) => void;
  togglePayment: (circleId: string, memberId: string, cycle: number) => void;
  markAllPaid: (circleId: string, cycle: number) => void;
  togglePaidOut: (circleId: string, cycle: number) => void;
}

export const useCircles = create<CirclesState>()(
  persist(
    (set) => {
      const patch = (id: string, fn: (c: Circle) => Circle) =>
        set((s) => ({ circles: s.circles.map((c) => (c.id === id ? fn(c) : c)) }));

      return {
        circles: [],
        hydrated: false,

        createCircle: (draft) => {
          const circle: Circle = {
            id: newId(),
            name: draft.name.trim(),
            installment: draft.installment,
            currency: 'EGP',
            frequency: draft.frequency,
            startDate: draft.startDate,
            members: draft.members.map((m) => ({ ...m, name: m.name.trim(), phone: m.phone?.trim() || undefined })),
            payments: [],
            paidOutCycles: [],
            createdAt: new Date().toISOString(),
          };
          set((s) => ({ circles: [circle, ...s.circles] }));
          return circle;
        },

        updateCircle: (id, draft) =>
          patch(id, (c) => {
            const memberIds = new Set(draft.members.map((m) => m.id));
            const cycles = draft.members.length;
            return {
              ...c,
              name: draft.name.trim(),
              installment: draft.installment,
              frequency: draft.frequency,
              startDate: draft.startDate,
              members: draft.members.map((m) => ({ ...m, name: m.name.trim(), phone: m.phone?.trim() || undefined })),
              // Drop payments for removed members or cycles that no longer exist.
              payments: c.payments.filter((p) => memberIds.has(p.memberId) && p.cycle < cycles),
              paidOutCycles: c.paidOutCycles.filter((cy) => cy < cycles),
            };
          }),

        deleteCircle: (id) => set((s) => ({ circles: s.circles.filter((c) => c.id !== id) })),

        togglePayment: (circleId, memberId, cycle) =>
          patch(circleId, (c) => togglePayment(c, memberId, cycle)),

        markAllPaid: (circleId, cycle) => patch(circleId, (c) => markAllPaid(c, cycle)),

        togglePaidOut: (circleId, cycle) => patch(circleId, (c) => togglePaidOut(c, cycle)),
      };
    },
    {
      name: 'gam3eya/circles',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ circles: s.circles }),
      onRehydrateStorage: () => () => useCircles.setState({ hydrated: true }),
    },
  ),
);

export const useCircle = (id: string | undefined) =>
  useCircles((s) => s.circles.find((c) => c.id === id));

export { newId };
