"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, Loader2, Plus, Trash2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/shared";
import { Btn } from "@/components/table";

export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, any>;
  viewMode: string;
  groupBy: string;
  isShared: boolean;
  ownerId?: string | null;
}

const GROUP_OPTIONS = [
  { value: "project", label: "Project" },
  { value: "assignee", label: "Assignee" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "tag", label: "Tag" },
  { value: "none", label: "None" },
];

/**
 * Saved view chips — a named snapshot of filters + view mode + lane grouping.
 * Applying a view mutates the page's filter state in one shot, which is the
 * main quality-of-life win over re-picking five dropdowns every visit.
 */
export function SavedViewBar({
  views,
  activeId,
  onApply,
  onViewsChanged,
  currentFilters,
  currentView,
  currentGroupBy,
  employees,
}: {
  views: SavedView[] | undefined | null;
  activeId: string;
  onApply: (v: SavedView) => void;
  onViewsChanged: () => void;
  currentFilters: Record<string, any>;
  currentView: string;
  currentGroupBy: string;
  employees: { id: string; name: string }[];
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/tasks/views", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          filters: currentFilters,
          viewMode: currentView,
          groupBy: currentGroupBy,
          isShared: shared,
        }),
      });
      setName("");
      setShared(false);
      setSaving(false);
      onViewsChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await apiFetch(`/tasks/views/${id}`, { method: "DELETE" }).catch(() => {});
    onViewsChanged();
  };

  const list = views ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground/70">
        <Bookmark className="size-3" /> Views
      </span>

      {list.map((v) => (
        <span key={v.id} className="group flex items-center">
          <button
            onClick={() => onApply(v)}
            className={cn(
              "flex items-center gap-1.5 rounded-l-xl border border-r-0 px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
              activeId === v.id ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {activeId === v.id ? <BookmarkCheck className="size-3" /> : <Bookmark className="size-3" />}
            {v.name}
            {v.isShared && <Users className="size-2.5 opacity-60" />}
          </button>
          <button
            onClick={() => remove(v.id)}
            aria-label={`Delete view ${v.name}`}
            className="flex h-[30px] items-center rounded-r-xl border border-border bg-card px-1.5 text-muted-foreground opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      ))}

      {saving ? (
        <div className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-2 py-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setSaving(false); }}
            placeholder="View name…"
            className="w-32 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
          />
          <label className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-muted-foreground" title="Visible to everyone">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-3 accent-primary" />
            team
          </label>
          <Btn variant="primary" onClick={save} disabled={busy || !name.trim()} className="!px-2 !py-1">
            {busy ? <Loader2 className="size-3 animate-spin" /> : "Save"}
          </Btn>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="flex items-center gap-1 rounded-xl border border-dashed border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Plus className="size-3" /> Save current
        </button>
      )}

      {/* group-by lives here since it only makes sense for board lanes */}
      <span className="ml-1 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground/70">
        Group by
        <select
          value={currentGroupBy}
          onChange={(e) => onApply({ id: "__group__", name: "", filters: currentFilters, viewMode: currentView, groupBy: e.target.value, isShared: false })}
          className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary/40"
        >
          {GROUP_OPTIONS.map((g) => (<option key={g.value} value={g.value}>{g.label}</option>))}
        </select>
      </span>
    </div>
  );
}
