"use client";

import { useCallback } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export function useApi<T = any>(path: string | null) {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery({
    queryKey: ["api", path],
    queryFn: () => apiFetch<T>(path as string),
    enabled: path !== null,
    // Keep the last payload visible while a refetch is in flight; otherwise
    // every window focus flashes "—"/zeroes across the whole page.
    placeholderData: keepPreviousData,
  });

  const mutate = useCallback(() => {
    if (path) queryClient.invalidateQueries({ queryKey: ["api", path] });
  }, [queryClient, path]);

  return {
    data: (data as T | undefined) ?? null,
    error: error ? (error as Error).message : null,
    loading: isPending,
    mutate,
  };
}