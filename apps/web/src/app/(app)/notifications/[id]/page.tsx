"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bell, Calendar, CheckCheck, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatDate, timeAgo } from "@/lib/format";
import { CardShell, EmptyState, FadeIn, PageHeader, SkeletonBlock, cn } from "@/components/shared";
import { categoryForType, typeMeta } from "@/components/notifications-dropdown";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  tasks: "Tasks",
  finance: "Finance",
  people: "People",
  business: "Business",
  system: "System",
};

/**
 * One page per notification so a bell click lands on exactly that item instead
 * of dropping the user on the whole inbox. Opening the page marks it read.
 */
export default function NotificationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params?.id === "string" ? params.id : "";
  const { data, error, loading } = useApi<Notification>(id ? `/notifications/${id}` : null);
  const [deleting, setDeleting] = useState(false);

  // Mark as read the moment the detail is opened — the inbox click can fail on
  // a flaky connection and the row would otherwise stay bold.
  useEffect(() => {
    if (!data || data.isRead) return;
    apiFetch(`/notifications/${data.id}/read`, { method: "PATCH" }).catch(() => {});
  }, [data]);

  const remove = async () => {
    if (!data || deleting) return;
    setDeleting(true);
    try {
      await apiFetch(`/notifications/${data.id}`, { method: "DELETE" });
      router.push("/notifications");
    } catch {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <SkeletonBlock className="h-8 w-48" />
        <CardShell>
          <SkeletonBlock className="h-5 w-2/3" />
          <SkeletonBlock className="mt-3 h-3 w-full" />
          <SkeletonBlock className="mt-2 h-3 w-4/5" />
        </CardShell>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader
          title="Notification"
          subtitle="This notification is no longer available."
          actions={
            <Link
              href="/notifications"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-meta font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Inbox
            </Link>
          }
        />
        <EmptyState
          title="Notification not found"
          hint={error ?? "It may have been deleted, or it belongs to another account."}
        />
      </div>
    );
  }

  const meta = typeMeta(data.type);
  const Icon = meta.icon ?? Bell;
  const category = CATEGORY_LABEL[categoryForType(data.type)] ?? "System";

  return (
    <FadeIn className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Notification"
        subtitle={timeAgo(data.createdAt)}
        actions={
          <>
            <Link
              href="/notifications"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-meta font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Inbox
            </Link>
            <button
              onClick={remove}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-meta font-semibold text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-500 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> {deleting ? "Deleting…" : "Delete"}
            </button>
          </>
        }
      />

      <CardShell>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-black/[0.03]",
              meta.tone
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-muted px-2 py-px text-micro font-bold uppercase tracking-wide text-muted-foreground">
                {category}
              </span>
              <span className="rounded-full bg-muted/70 px-2 py-px text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">
                {meta.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-px text-micro font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCheck className="size-3" /> Read
              </span>
            </div>
            <h2 className="mt-2 font-heading text-section font-semibold leading-snug">{data.title}</h2>
            <p className="mt-2 whitespace-pre-wrap text-body-lg leading-relaxed text-muted-foreground">{data.message}</p>

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3 text-micro text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3.5" /> {formatDate(data.createdAt)}
              </span>
              <span className="font-mono text-micro text-muted-foreground/70">{data.type}</span>
            </div>

            {data.link && (
              <Link
                href={data.link}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-meta font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Open related page <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
        </div>
      </CardShell>
    </FadeIn>
  );
}
