"use client";

/**
 * Same-origin by default: the Next server proxies `/api/*` to the API
 * (`API_PROXY_TARGET`), which works on localhost, behind the Cloudflare tunnel
 * and in any single-origin deploy. Without this default a build that forgot to
 * set NEXT_PUBLIC_API_URL shipped `http://localhost:4000` and every visitor's
 * browser called *their own machine* — the page loaded, the data never did.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/**
 * Error carrying the HTTP status so callers can tell "your session is invalid"
 * (401/403 — log out) apart from "the server hiccuped" (500/network — retry).
 * Without the status every failure looked identical and wiped the token.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const UNAUTHORIZED_EVENT = "zoolyum:unauthorized";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("zoolyum-token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("zoolyum-token", token);
  else localStorage.removeItem("zoolyum-token");
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      // Always revalidate with the API. Without this the browser can replay a
      // stale JSON body on a 304 after a deploy, which looks like "the data is
      // wrong" until a hard refresh.
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    // Network failure (API restarting, offline) — status 0, not an auth problem.
    throw new ApiError("Cannot reach the server. Check that the API is running.", 0);
  }
  if (!res.ok) {
    // A token that existed but was rejected means the session is dead (expired,
    // deactivated, password reset, permission change). Tell the shell once so it
    // can sign the user out instead of leaving every page erroring.
    if (res.status === 401 && token) {
      setToken(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
    }
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message ?? `Request failed: ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export async function apiFetchFormData<T = any>(
  path: string,
  formData: FormData
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
    }
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
