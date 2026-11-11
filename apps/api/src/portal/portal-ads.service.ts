import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PortalAccessService, PortalScope } from "./portal-access.service";

type Range = { from: Date; to: Date };

const DAY = 86400000;

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function ratio(n: number) {
  return Math.round(n * 10000) / 10000;
}

/** Parse ?from=&to= (YYYY-MM-DD) with a 30-day default window, clamped to 366 days. */
function parseRange(from?: string, to?: string): Range {
  const now = new Date();
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  let start = from
    ? new Date(`${from}T00:00:00.000Z`)
    : new Date(end.getTime() - 29 * DAY);
  if (Number.isNaN(start.getTime())) start = new Date(end.getTime() - 29 * DAY);
  if (Number.isNaN(end.getTime())) return parseRange(undefined, undefined);
  if (start > end) start = new Date(end.getTime() - 29 * DAY);
  if (end.getTime() - start.getTime() > 366 * DAY) start = new Date(end.getTime() - 366 * DAY);
  return { from: start, to: end };
}

function shiftBack(range: Range): Range {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span - 1), to: new Date(range.from.getTime() - 1) };
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function pctDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

/** True only for a full calendar month (UTC) — the only window a monthly budget can be compared against. */
function isFullCalendarMonth(range: Range): boolean {
  const from = range.from;
  const to = range.to;
  const lastDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  return (
    from.getUTCDate() === 1 &&
    from.getUTCHours() === 0 &&
    from.getUTCMinutes() === 0 &&
    to.getUTCDate() === lastDay &&
    to.getUTCHours() === 23 &&
    to.getUTCMinutes() === 59
  );
}

type Row = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
};

function totals(rows: { spend: any; impressions: number; clicks: number; conversions: number; conversionValue: any }[]): Row {
  const t = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
  for (const r of rows) {
    t.spend += Number(r.spend ?? 0);
    t.impressions += Number(r.impressions ?? 0);
    t.clicks += Number(r.clicks ?? 0);
    t.conversions += Number(r.conversions ?? 0);
    t.conversionValue += Number(r.conversionValue ?? 0);
  }
  return t;
}

/**
 * Client-facing advertising performance.
 *
 * Every query is anchored to the `clientId` resolved from the portal token and
 * restricted to campaign-grain rows (`adSetId`/`adId` null) so spend is never
 * double counted across ad-set and ad rows.
 */
@Injectable()
export class PortalAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PortalAccessService
  ) {}

  private baseWhere(scope: PortalScope, range: Range) {
    return {
      clientId: scope.clientId,
      date: { gte: range.from, lte: range.to },
      adSetId: null,
      adId: null,
    };
  }

  /** Throws when the contact may not see advertising data at all. */
  private guard(scope: PortalScope) {
    this.access.requireModule(scope, "PERFORMANCE");
    if (!scope.canSeeAdSpend) {
      return false;
    }
    return true;
  }

  private async hasAccounts(scope: PortalScope) {
    const count = await this.prisma.adAccount.count({ where: { clientId: scope.clientId } });
    return count;
  }

  private async lastSynced(scope: PortalScope): Promise<Date | null> {
    const row = await this.prisma.adAccount.findFirst({
      where: { clientId: scope.clientId, lastSyncAt: { not: null } },
      orderBy: { lastSyncAt: "desc" },
      select: { lastSyncAt: true },
    });
    return row?.lastSyncAt ?? null;
  }

  async summary(scope: PortalScope, from?: string, to?: string) {
    if (!this.guard(scope)) return { available: false, reason: "DISABLED" };

    const accounts = await this.hasAccounts(scope);
    if (!accounts) return { available: false, reason: "NO_ACCOUNT" };

    const range = parseRange(from, to);
    const prevRange = shiftBack(range);

    const [current, previous, byPlatform, campaignsRunning] = await Promise.all([
      this.prisma.adInsight.findMany({
        where: this.baseWhere(scope, range),
        select: { spend: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
      }),
      this.prisma.adInsight.findMany({
        where: this.baseWhere(scope, prevRange),
        select: { spend: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
      }),
      this.prisma.adInsight.groupBy({
        by: ["provider"],
        where: this.baseWhere(scope, range),
        _sum: { spend: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
      }),
      this.prisma.adCampaign.count({
        where: { adAccount: { clientId: scope.clientId }, status: { in: ["ENABLED", "ACTIVE"] } },
      }),
    ]);

    const cur = totals(current);
    const prev = totals(previous);

    const ctr = cur.impressions ? (cur.clicks / cur.impressions) * 100 : 0;
    const prevCtr = prev.impressions ? (prev.clicks / prev.impressions) * 100 : 0;
    const cpc = cur.clicks ? cur.spend / cur.clicks : 0;
    const prevCpc = prev.clicks ? prev.spend / prev.clicks : 0;
    const cpm = cur.impressions ? (cur.spend / cur.impressions) * 1000 : 0;
    const prevCpm = prev.impressions ? (prev.spend / prev.impressions) * 1000 : 0;
    const cpa = cur.conversions ? cur.spend / cur.conversions : 0;
    const prevCpa = prev.conversions ? prev.spend / prev.conversions : 0;
    const roas = cur.spend ? cur.conversionValue / cur.spend : 0;
    const prevRoas = prev.spend ? prev.conversionValue / prev.spend : 0;

    const platforms = byPlatform.map((p) => {
      const s = p._sum;
      const spend = Number(s.spend ?? 0);
      const value = Number(s.conversionValue ?? 0);
      return {
        provider: p.provider,
        spend: money(spend),
        impressions: s.impressions ?? 0,
        clicks: s.clicks ?? 0,
        conversions: s.conversions ?? 0,
        conversionValue: money(value),
        ctr: ratio(s.impressions ? ((s.clicks ?? 0) / s.impressions) * 100 : 0),
        cpc: money(s.clicks ? spend / s.clicks : 0),
        roas: ratio(spend ? value / spend : 0),
      };
    });

    return {
      available: true,
      range: { from: dayKey(range.from), to: dayKey(range.to) },
      previousRange: { from: dayKey(prevRange.from), to: dayKey(prevRange.to) },
      hasData: current.length > 0,
      lastSyncedAt: await this.lastSynced(scope),
      campaignsRunning,
      metrics: {
        spend: money(cur.spend),
        impressions: cur.impressions,
        clicks: cur.clicks,
        conversions: cur.conversions,
        conversionValue: money(cur.conversionValue),
        ctr: ratio(ctr),
        cpc: money(cpc),
        cpm: money(cpm),
        cpa: money(cpa),
        roas: ratio(roas),
        cpl: cur.conversions ? money(cur.spend / cur.conversions) : 0,
      },
      deltas: {
        spend: pctDelta(cur.spend, prev.spend),
        impressions: pctDelta(cur.impressions, prev.impressions),
        clicks: pctDelta(cur.clicks, prev.clicks),
        conversions: pctDelta(cur.conversions, prev.conversions),
        conversionValue: pctDelta(cur.conversionValue, prev.conversionValue),
        ctr: pctDelta(ctr, prevCtr),
        cpc: pctDelta(cpc, prevCpc),
        cpm: pctDelta(cpm, prevCpm),
        cpa: pctDelta(cpa, prevCpa),
        roas: pctDelta(roas, prevRoas),
      },
      previous: {
        spend: money(prev.spend),
        conversions: prev.conversions,
        conversionValue: money(prev.conversionValue),
      },
      platforms,
    };
  }

  async trend(scope: PortalScope, from?: string, to?: string, granularity: "day" | "week" = "day") {
    if (!this.guard(scope)) return { available: false, reason: "DISABLED" };
    if (!(await this.hasAccounts(scope))) return { available: false, reason: "NO_ACCOUNT" };

    const range = parseRange(from, to);
    const rows = await this.prisma.adInsight.findMany({
      where: this.baseWhere(scope, range),
      select: { date: true, spend: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
      orderBy: { date: "asc" },
    });

    const bucket = (d: Date) => {
      if (granularity !== "week") return dayKey(d);
      const monday = new Date(d);
      const dow = (monday.getUTCDay() + 6) % 7; // Monday = 0
      monday.setUTCDate(monday.getUTCDate() - dow);
      return dayKey(monday);
    };

    const map = new Map<string, Row>();
    for (const r of rows) {
      const k = bucket(new Date(r.date));
      const e = map.get(k) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      e.spend += Number(r.spend ?? 0);
      e.impressions += r.impressions ?? 0;
      e.clicks += r.clicks ?? 0;
      e.conversions += r.conversions ?? 0;
      e.conversionValue += Number(r.conversionValue ?? 0);
      map.set(k, e);
    }

    // Emit an unbroken series so the chart has no gaps on quiet days.
    const series: { date: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; ctr: number; roas: number }[] = [];
    const cursor = new Date(range.from);
    if (granularity === "week") {
      const dow = (cursor.getUTCDay() + 6) % 7;
      cursor.setUTCDate(cursor.getUTCDate() - dow);
    }
    while (cursor <= range.to) {
      const k = dayKey(cursor);
      const e = map.get(k) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      series.push({
        date: k,
        spend: money(e.spend),
        impressions: e.impressions,
        clicks: e.clicks,
        conversions: e.conversions,
        conversionValue: money(e.conversionValue),
        ctr: ratio(e.impressions ? (e.clicks / e.impressions) * 100 : 0),
        roas: ratio(e.spend ? e.conversionValue / e.spend : 0),
      });
      cursor.setUTCDate(cursor.getUTCDate() + (granularity === "week" ? 7 : 1));
    }

    return {
      available: true,
      granularity,
      range: { from: dayKey(range.from), to: dayKey(range.to) },
      series,
    };
  }

  async campaigns(scope: PortalScope, from?: string, to?: string) {
    if (!this.guard(scope)) return { available: false, reason: "DISABLED" };
    if (!(await this.hasAccounts(scope))) return { available: false, reason: "NO_ACCOUNT" };

    const range = parseRange(from, to);
    const rows = await this.prisma.adInsight.findMany({
      where: this.baseWhere(scope, range),
      select: {
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
        conversionValue: true,
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            budget: true,
            objective: true,
            adAccount: { select: { provider: true } },
          },
        },
      },
    });

    const map = new Map<
      string,
      {
        id: string;
        name: string;
        status: string;
        objective: string | null;
        provider: string;
        budget: number | null;
        spend: number;
        impressions: number;
        clicks: number;
        conversions: number;
        conversionValue: number;
      }
    >();

    for (const r of rows) {
      const key = r.campaign?.id ?? "unknown";
      const e =
        map.get(key) ??
        {
          id: key,
          name: r.campaign?.name ?? "Unattributed",
          status: r.campaign?.status ?? "UNKNOWN",
          objective: r.campaign?.objective ?? null,
          provider: r.campaign?.adAccount?.provider ?? "—",
          budget: r.campaign?.budget != null ? Number(r.campaign.budget) : null,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValue: 0,
        };
      e.spend += Number(r.spend ?? 0);
      e.impressions += r.impressions ?? 0;
      e.clicks += r.clicks ?? 0;
      e.conversions += r.conversions ?? 0;
      e.conversionValue += Number(r.conversionValue ?? 0);
      map.set(key, e);
    }

    const items = Array.from(map.values())
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        provider: c.provider,
        budget: c.budget != null ? money(c.budget) : null,
        spend: money(c.spend),
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        conversionValue: money(c.conversionValue),
        ctr: ratio(c.impressions ? (c.clicks / c.impressions) * 100 : 0),
        cpc: money(c.clicks ? c.spend / c.clicks : 0),
        cpa: money(c.conversions ? c.spend / c.conversions : 0),
        roas: ratio(c.spend ? c.conversionValue / c.spend : 0),
        // Budget pacing only makes sense when a budget exists and the window is
        // a full calendar month; 7/90-day spend is not a monthly pace.
        budgetUsedPct: c.budget && isFullCalendarMonth(range) ? ratio((c.spend / c.budget) * 100) : null,
      }))
      .sort((a, b) => b.spend - a.spend);

    return {
      available: true,
      range: { from: dayKey(range.from), to: dayKey(range.to) },
      totalSpend: money(items.reduce((s, c) => s + c.spend, 0)),
      items,
    };
  }
}
