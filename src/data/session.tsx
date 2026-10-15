import { createContext, useContext, type ReactNode } from 'react';

import { useSession, type Session } from './auth';

const SessionContext = createContext<Session>({ user: null, loading: true, isAccount: false });

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Current Firebase session (subscribed once at the root). */
export const useAppSession = () => useContext(SessionContext);

export { useSession };
