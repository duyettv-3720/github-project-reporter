// Presentation: turn a Report into the plain-text body and the Slack payload.
// All wording comes from config (REPORT_LABELS / NO_STATUS_LABEL).

import { STALE_DAYS, NO_STATUS_LABEL, REPORT_LABELS } from "./config";
import type { NormalizedItem, Report, SlackPayload } from "./types";

const fmtDate = (d: Date | null): string =>
  d
    ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(
        d.getUTCMonth() + 1
      ).padStart(2, "0")}/${d.getUTCFullYear()}`
    : "-";

const itemLabel = (it: NormalizedItem): string => {
  const who = it.assignees.length ? ` (@${it.assignees.join(", @")})` : "";
  const num = it.number ? `#${it.number} ` : "";
  return `${num}${it.title}${who}`;
};

// Group items by their Status value, preserving first-seen order.
function groupByStatus(items: NormalizedItem[]): Map<string, NormalizedItem[]> {
  const map = new Map<string, NormalizedItem[]>();
  for (const it of items) {
    const key = it.status ?? NO_STATUS_LABEL;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(it);
  }
  return map;
}

// Full plain-text report. All sections are always shown (empty ones display a
// count of 0 rather than being hidden). Used for console output and, wrapped in
// a Slack code block, for the Slack message.
export function renderReport(r: Report): string {
  const L: string[] = [];
  L.push(REPORT_LABELS.reportTitle);
  L.push("");
  L.push(REPORT_LABELS.overview);
  L.push("");
  L.push(
    `Sprint: ${
      r.sprint
        ? `${r.sprint.title} (${fmtDate(new Date(r.sprint.startDate))} - ${fmtDate(r.sprintEnd)})`
        : "(no active Target version)"
    }`
  );
  L.push(`Progress: ${r.progress}% (${r.total} items)`);
  L.push(`Due Date: ${r.sprintEnd ? fmtDate(r.sprintEnd) : "-"}`);
  L.push("");

  // Status Summary — all counts on a single line.
  const statusEntries = Object.entries(r.statusCounts);
  const statusLine = statusEntries.length
    ? statusEntries.map(([k, v]) => `${k}: ${v}`).join(" • ")
    : "(no items)";
  L.push(`${REPORT_LABELS.statusSummary} ${statusLine}`);
  L.push("");

  // Current Working Items, grouped by status
  L.push(REPORT_LABELS.working);
  L.push("");
  if (r.working.length) {
    const groups = [...groupByStatus(r.working)];
    groups.forEach(([status, items], idx) => {
      L.push(`${status}:`);
      items.forEach((it) => L.push(`• ${itemLabel(it)}`));
      if (idx < groups.length - 1) L.push("");
    });
  } else {
    L.push("(none)");
  }
  L.push("");

  // Attention Items — only sub-sections that actually have items are shown.
  const a = r.attention;
  const attention: string[] = [];
  const block = (
    label: string,
    items: NormalizedItem[],
    fmt?: (it: NormalizedItem) => string
  ): void => {
    if (!items.length) return;
    attention.push(`• ${label} (${items.length})`);
    items.forEach((it) => attention.push(`  - ${fmt ? fmt(it) : itemLabel(it)}`));
  };

  // Declarative list of attention sub-sections — add/remove a line to change
  // which checks appear, in render order.
  const sections: Array<
    [string, NormalizedItem[], ((it: NormalizedItem) => string)?]
  > = [
    ["No Assignee", a.noAssignee],
    ["Overdue", a.overdue, (it) => `${itemLabel(it)} (due ${fmtDate(it.dueDate)})`],
    ["High Priority Open", a.highPriority, (it) => `${itemLabel(it)} [${it.priority}]`],
    [`No Update > ${STALE_DAYS} days`, a.stale],
  ];
  for (const [label, items, fmt] of sections) block(label, items, fmt);

  if (attention.length) {
    L.push(REPORT_LABELS.attention);
    L.push("");
    L.push(...attention);
  }

  return L.join("\n").trimEnd();
}

// Wrap the report text in a Slack code block so it renders monospace.
export const toSlackPayload = (r: Report): SlackPayload => ({
  text: "```\n" + renderReport(r) + "\n```",
});
