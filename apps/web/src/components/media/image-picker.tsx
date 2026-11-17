"use client";
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { API_URL, apiFetch, getToken } from "@/lib/api";
import { cn } from "@/components/shared";

/**
 * One image picker for every logo/photo in the app.
 *
 * The server does the encoding (WebP + optional JPEG XL, resized + metadata
 * stripped) — this component only posts the file, shows progress and lets the
 * parent reload. Upload happens immediately (not on form save) because the
 * endpoint stores the image itself.
 */
export async function uploadImage(
  file: File,
  endpoint: string
): Promise<{ url?: string; jxlUrl?: string; logoUrl?: string; logoJxlUrl?: string; photoUrl?: string; photoJxlUrl?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const token = getToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? "Upload failed");
  return body;
}

export function ImagePicker({
  src,
  jxlSrc,
  name,
  endpoint,
  removeEndpoint,
  onDone,
  shape = "circle",
  sizeClass = "size-20",
  title = "Upload image",
  hint,
  disabled,
  compact = false,
}: {
  src?: string | null;
  jxlSrc?: string | null;
  name: string;
  endpoint: string;
  removeEndpoint?: string;
  onDone: (result: any) => void;
  shape?: "circle" | "rounded" | "square";
  sizeClass?: string;
  title?: string;
  hint?: string;
  disabled?: boolean;
  /** Avatar-only variant for tight rows (identity strips, table cells). */
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const rounded = shape === "circle" ? "rounded-full" : shape === "rounded" ? "rounded-2xl" : "rounded-lg";

  const pick = async (file?: File | null) => {
    if (!file || disabled) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await uploadImage(file, endpoint);
      onDone(result);
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removeEndpoint || disabled) return;
    if (!window.confirm("Remove this image?")) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(removeEndpoint, { method: "DELETE" });
      onDone(null);
    } catch (e: any) {
      setErr(e?.message ?? "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          title={title}
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "group relative flex shrink-0 items-center justify-center overflow-hidden border border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed",
            rounded,
            sizeClass
          )}
        >
          {src ? (
            <picture>
              {jxlSrc && <source type="image/jxl" srcSet={jxlSrc} />}
              <img src={src} alt={name} className="size-full object-cover" />
            </picture>
          ) : (
            <span className="text-body-lg font-bold">{initials || <Camera className="size-5" />}</span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            {busy ? <Loader2 className="size-4 animate-spin text-white" /> : <Camera className="size-4 text-white" />}
          </span>
        </button>
        <div className={cn("min-w-0", compact ? "hidden" : "flex-1")}>
          <p className="text-meta font-semibold">{title}</p>
          <p className="text-micro text-muted-foreground">{hint ?? "JPG / PNG / WebP — auto-converted to WebP + JPEG XL"}</p>
          {src && removeEndpoint && (
            <button
              type="button"
              onClick={remove}
              disabled={busy || disabled}
              className="mt-1 inline-flex items-center gap-1 text-micro font-semibold text-rose-400 hover:underline disabled:opacity-50"
            >
              <Trash2 className="size-3" /> Remove
            </button>
          )}
        </div>
        {compact && src && removeEndpoint && (
          <button
            type="button"
            onClick={remove}
            disabled={busy || disabled}
            title="Remove image"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void pick(f);
          }}
        />
      </div>
      {err && <p className="text-micro font-medium text-rose-400">{err}</p>}
    </div>
  );
}
