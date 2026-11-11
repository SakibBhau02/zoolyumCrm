import { Injectable } from "@nestjs/common";
import { CalendarFeedService, FeedParams } from "./calendar-feed.service";
import { dhakaInstant } from "./calendar.utils";

/** iCalendar / CSV export of the merged feed (subscribe or spreadsheet). */
@Injectable()
export class CalendarExportService {
  constructor(private readonly feed: CalendarFeedService) {}

  async csv(params: FeedParams) {
    const data = await this.feed.feed({ ...params, limit: 3000 });
    const header = [
      "Date",
      "Time",
      "Source",
      "Title",
      "Client",
      "Project",
      "Campaign",
      "Platforms",
      "Status",
      "Approval",
      "Owner",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const i of data.items) {
      lines.push(
        [
          i.date,
          i.startTime ?? (i.allDay ? "All day" : ""),
          i.source,
          i.title,
          i.clientName ?? "",
          i.projectName ?? "",
          i.campaignName ?? "",
          i.platforms.join("|"),
          i.status,
          i.approval ?? "",
          i.assigneeNames.join(", "),
        ]
          .map(esc)
          .join(",")
      );
    }
    return {
      filename: `calendar-${data.range.from}-to-${data.range.to}.csv`,
      mime: "text/csv;charset=utf-8",
      content: "\uFEFF" + lines.join("\r\n"),
    };
  }

  async ics(params: FeedParams) {
    const data = await this.feed.feed({ ...params, limit: 3000 });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const escText = (v: string) =>
      String(v ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
    const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Zoolyum OS//Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Zoolyum Calendar",
      "X-WR-TIMEZONE:Asia/Dhaka",
    ];
    for (const i of data.items) {
      if (i.source === "HOLIDAY") {
        lines.push("BEGIN:VEVENT", `UID:${i.key}@zoolyum`, `DTSTAMP:${stamp}`);
        lines.push(`DTSTART;VALUE=DATE:${i.date.replace(/-/g, "")}`);
        const endDay = new Date(new Date(`${i.date}T00:00:00Z`).getTime() + 86_400_000)
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        lines.push(`DTEND;VALUE=DATE:${endDay}`);
        lines.push(`SUMMARY:${escText(i.title)}`);
        lines.push("END:VEVENT");
        continue;
      }
      lines.push("BEGIN:VEVENT", `UID:${i.key}@zoolyum`, `DTSTAMP:${stamp}`);
      if (i.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${i.date.replace(/-/g, "")}`);
        const endBase = i.endDate ?? i.date;
        const endDay = new Date(new Date(`${endBase}T00:00:00Z`).getTime() + 86_400_000)
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        lines.push(`DTEND;VALUE=DATE:${endDay}`);
      } else {
        const start = dhakaInstant(i.date, i.startTime ?? "10:00");
        const end = i.endTime
          ? dhakaInstant(i.date, i.endTime)
          : new Date(start.getTime() + 60 * 60_000);
        lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
      }
      const summary = i.clientName ? `${i.title} · ${i.clientName}` : i.title;
      lines.push(`SUMMARY:${escText(summary)}`);
      const desc = [
        `Source: ${i.source}`,
        `Status: ${i.status}`,
        i.approval ? `Approval: ${i.approval}` : null,
        i.platforms.length ? `Platforms: ${i.platforms.join(", ")}` : null,
        i.projectName ? `Project: ${i.projectName}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      lines.push(`DESCRIPTION:${escText(desc)}`);
      if (i.clientName) lines.push(`CATEGORIES:${escText(i.clientName)}`);
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return {
      filename: `calendar-${data.range.from}-to-${data.range.to}.ics`,
      mime: "text/calendar;charset=utf-8",
      content: lines.join("\r\n"),
    };
  }
}
