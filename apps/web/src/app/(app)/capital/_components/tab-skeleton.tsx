/**
 * Placeholder while a tab chunk (tabs.tsx + modals + recharts) is downloading.
 *
 * Every capital route used to import all eight tabs statically, so opening
 * /capital/vendors shipped the whole finance module. With `next/dynamic` the
 * route chunk is only the few lines of its page and this paints immediately.
 */
export function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading tab">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted/70" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />
    </div>
  );
}
