'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { LoginDialog } from './login-dialog';

type AuthContextValue = {
  user: User | null;
  /** True when the signed-in user's profile has `is_qa_tester = true`. Gates QA-only UI. */
  isQaTester: boolean;
  loading: boolean;
  openLogin: (onSuccess?: () => void) => void;
  closeLogin: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Wrap an action so it requires auth — opens the login dialog if anonymous. */
export function useRequireAuth() {
  const { user, openLogin } = useAuth();
  return useCallback(
    (action: () => void) => {
      if (user) action();
      else openLogin(action);
    },
    [user, openLogin],
  );
}

export function AuthProvider({
  initialUser,
  initialIsQaTester = false,
  children,
}: {
  initialUser: User | null;
  initialIsQaTester?: boolean;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [isQaTester, setIsQaTester] = useState(initialIsQaTester);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const onSuccessRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (nextUser) {
        setOpen(false);
        // Refresh the QA flag from the profile whenever the session changes.
        void supabase
          .from('profiles')
          .select('is_qa_tester')
          .eq('id', nextUser.id)
          .maybeSingle()
          .then(({ data }) => setIsQaTester(data?.is_qa_tester ?? false));
        const cb = onSuccessRef.current;
        onSuccessRef.current = null;
        cb?.();
      } else {
        setIsQaTester(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const openLogin = useCallback((onSuccess?: () => void) => {
    onSuccessRef.current = onSuccess ?? null;
    setOpen(true);
  }, []);
  const closeLogin = useCallback(() => {
    onSuccessRef.current = null;
    setOpen(false);
  }, []);

  const value = useMemo(
    () => ({ user, isQaTester, loading, openLogin, closeLogin }),
    [user, isQaTester, loading, openLogin, closeLogin],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginDialog open={open} onClose={closeLogin} />
    </AuthContext.Provider>
  );
}
