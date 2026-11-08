"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { apiFetch, getToken, setToken, UNAUTHORIZED_EVENT } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roleName?: string;
  permissions?: Record<string, { view: boolean; edit: boolean; approve: boolean }>;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  employeeId?: string | null;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** Set when the session could not be verified for a non-auth reason (API down). */
  loadError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  loadError: null,
  login: async () => {},
  logout: () => {},
  retry: () => {},
});

const MAX_AUTO_RETRIES = 2;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  // A 401 on any request (expired token, deactivation, password reset,
  // permission change) means the session is gone for good. Sign out once here
  // instead of letting each page render its own "Unauthorized" error.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUnauthorized = () => {
      setToken(null);
      setUser(null);
      setLoadError(null);
      window.location.href = "/login";
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<SessionUser>("/auth/me")
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = (err as { status?: number })?.status ?? 0;

        // Only a real auth rejection means the session is gone.
        if (status === 401 || status === 403) {
          setToken(null);
          setUser(null);
          setLoadError(null);
          return;
        }

        // API restarting / offline: keep the token and the user signed in.
        // Retrying silently beats bouncing them to the login screen.
        setLoadError(err?.message ?? "Cannot reach the server");
        if (attempt < MAX_AUTO_RETRIES) {
          setTimeout(() => {
            if (!cancelled) setAttempt((a) => a + 1);
          }, 1200 * (attempt + 1));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ accessToken: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(res.accessToken);
    setUser(res.user);
    setLoadError(null);
  }, []);

  const logout = useCallback(() => {
    // Revoke this session on the server (best effort), then clear locally.
    void apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    setToken(null);
    setUser(null);
    setLoadError(null);
    if (typeof window !== "undefined") window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, loadError, login, logout, retry }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
