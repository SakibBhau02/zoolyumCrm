import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <p className="font-heading text-[42px] font-bold leading-none text-primary">404</p>
        <p className="mt-2 font-heading text-[16px] font-semibold">Page not found</p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          The page you followed does not exist, or you no longer have access to it.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex rounded-xl bg-brand-gradient px-4 py-2 text-[12.5px] font-semibold text-white"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
