"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Every route shipped the same `<title>` — "Zoolyum OS - Agency Operating
 * System" (WCAG 2.4.2, audit UX-04). Tabs, bookmarks and screen-reader page
 * announcements could not tell Dashboard from Capital.
 *
 * Client pages cannot export `metadata`, so the title is derived from the path
 * once per navigation instead of adding 55 near-identical metadata exports.
 */
const ROUTES: Array<[RegExp, string]> = [
  [/^\/(dashboard)?$/, "Dashboard"],
  [/^\/pulse/, "Pulse"],
  [/^\/accounts/, "Accounts"],
  [/^\/flow/, "Flow"],
  [/^\/tasks/, "Tasks"],
  [/^\/people\/payroll/, "Payroll"],
  [/^\/people\/leave/, "Leave"],
  [/^\/people/, "People"],
  [/^\/capital\/dollar/, "Dollar desk"],
  [/^\/capital/, "Capital"],
  [/^\/insight/, "Insight"],
  [/^\/calendar/, "Calendar"],
  [/^\/portal/, "Portal"],
  [/^\/control/, "Control"],
  [/^\/notifications/, "Notifications"],
  [/^\/login$/, "Sign in"],
  [/^\/portal-login$/, "Client portal"],
  [/^\/share\//, "Shared plan"],
];

export function RouteTitle({ appName }: { appName?: string }) {
  const pathname = usePathname();

  useEffect(() => {
    const label = ROUTES.find(([pattern]) => pattern.test(pathname ?? "/"))?.[1];
    const brand = appName?.trim() || "Zoolyum OS";
    const wanted = label ? `${label} · ${brand}` : brand;

    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    // Next re-applies the root metadata title on client navigations, which
    // overwrote the first attempt. Watch <head> and restore it (idempotent —
    // the guard above stops the observer from looping on our own writes).
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname, appName]);

  return null;
}
