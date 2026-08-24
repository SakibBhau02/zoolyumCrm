"use client";
import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { EmptyState, FadeIn, SkeletonBlock } from "@/components/shared";
import { Btn, TableShell, THead, Th } from "@/components/table";

export function useList<T = any>(path: string | null, refresh = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<T>(path).then((d) => !cancelled && setData(d)).catch((e) => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [path, refresh]);
  return { data, error, loading };
}

export function useToast() {
  const [flash, setFlash] = useState<string | null>(null);
  const notify = useCallback((msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(null), 3000); }, []);
  return { flash, notify };
}

export function Toast({ flash }: { flash: string | null }) {
  if (!flash) return null;
  return <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-xl bg-sidebar px-4 py-2.5 text-[12.5px] font-medium text-white shadow-xl">{flash}</motion.div>;
}

export function LoadOrError({ loading, error, onRetry, skeleton = 6, h = "h-12" }: { loading: boolean; error: string | null; onRetry?: () => void; skeleton?: number; h?: string }) {
  if (loading) return <div className="flex flex-col gap-2">{[...Array(skeleton)].map((_, i) => <SkeletonBlock key={i} className={h} />)}</div>;
  if (error)
    return (
      <div>
        <EmptyState title={error} hint="Failed to load data" />
        {onRetry && <div className="mt-3 flex justify-center"><Btn variant="outline" onClick={onRetry}><RefreshCw className="size-3.5" /> Retry</Btn></div>}
      </div>
    );
  return null;
}

export function DataTable({ loading, error, onRetry, footer, cols, rows, skeleton = 6 }: { loading: boolean; error: string | null; onRetry?: () => void; footer?: React.ReactNode; cols: React.ReactNode[]; rows: React.ReactNode[]; skeleton?: number }) {
  return (
    <div>
      <LoadOrError loading={loading} error={error} onRetry={onRetry} skeleton={skeleton} />
      {!loading && !error && (
        <FadeIn>
          <TableShell footer={footer}>
            <table className="w-full">
              <THead>{cols.map((c, i) => <Th key={i}>{c}</Th>)}</THead>
              <tbody>{rows}</tbody>
            </table>
          </TableShell>
        </FadeIn>
      )}
    </div>
  );
}