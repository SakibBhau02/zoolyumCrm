"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { apiFetch, setToken } from "./api";

/**
 * Browser side of the fingerprint flow.
 *
 * Uses the platform authenticator (Windows Hello / Touch ID / Android
 * biometrics) through WebAuthn. The server stores only the public key; the
 * fingerprint itself never leaves the device.
 */

export function webAuthnSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export interface FingerprintRow {
  id: string;
  deviceLabel: string | null;
  transports: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listFingerprints(): Promise<FingerprintRow[]> {
  return apiFetch<FingerprintRow[]>("/auth/webauthn/credentials");
}

export async function registerFingerprint(deviceLabel?: string) {
  const options = await apiFetch<any>("/auth/webauthn/register/options", { method: "POST" });
  const response = await startRegistration({ optionsJSON: options });
  return apiFetch<{ ok: boolean; id: string; deviceLabel: string }>("/auth/webauthn/register/verify", {
    method: "POST",
    body: JSON.stringify({ response, deviceLabel }),
  });
}

export async function deleteFingerprint(id: string) {
  return apiFetch(`/auth/webauthn/credentials/${id}`, { method: "DELETE" });
}

/**
 * Passwordless sign-in. `email` is optional: with it the server narrows the
 * allow-list; without it the browser offers any discoverable credential
 * (usernameless flow), which is the "just touch the sensor" experience.
 */
export async function loginWithFingerprint(email?: string) {
  const { flowId, options } = await apiFetch<{ flowId: string; options: any }>(
    "/auth/webauthn/login/options",
    { method: "POST", body: JSON.stringify({ email: email || undefined }) }
  );
  const response = await startAuthentication({ optionsJSON: options });
  const session = await apiFetch<{ accessToken: string; user: any }>("/auth/webauthn/login/verify", {
    method: "POST",
    body: JSON.stringify({ flowId, response }),
  });
  setToken(session.accessToken);
  return session;
}

/** Prove presence with the registered fingerprint before a clock action. */
export async function verifyFingerprintForClock() {
  const options = await apiFetch<any>("/auth/webauthn/clock/options", { method: "POST" });
  const response = await startAuthentication({ optionsJSON: options });
  return apiFetch<{ verified: boolean }>("/auth/webauthn/clock/verify", {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

export function biometricErrorMessage(err: any): string {
  const name = err?.name ?? "";
  if (name === "NotAllowedError") return "Fingerprint was cancelled or timed out.";
  if (name === "InvalidStateError") return "This device is already registered.";
  if (name === "NotSupportedError") return "This device/browser does not support fingerprint sign-in.";
  return err?.message ?? "Fingerprint request failed.";
}
