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
  children,
}: {
  initialUser: User | null;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const onSuccessRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setOpen(false);
        const cb = onSuccessRef.current;
        onSuccessRef.current = null;
        cb?.();
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
    () => ({ user, loading, openLogin, closeLogin }),
    [user, loading, openLogin, closeLogin],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginDialog open={open} onClose={closeLogin} />
    </AuthContext.Provider>
  );
}
