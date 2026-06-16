// Pure analysis: turn raw GraphQL items into a flattened, summarized Report.
// No IO here — easy to reason about and test in isolation.

import {
  STATUS_FIELD,
  ITERATION_FIELD,
  PRIORITY_FIELD,
  DUE_DATE_FIELD,
  DONE_STATUSES,
  TODO_STATUSES,
  HIGH_PRIORITIES,
  STALE_DAYS,
  SCOPE_TO_CURRENT_ITERATION,
  NO_STATUS_LABEL,
} from "./config";
import type {
  Iteration,
  IterationConfig,
  NormalizedItem,
  RawItem,
  Report,
} from "./types";

// Flatten a raw project item into a plain shape that's easy to report on.
export function normalizeItem(item: RawItem): NormalizedItem | null {
  const c = item.content;
  if (!c) return null;

  const singleSelect: Record<string, string> = {};
  const dates: Record<string, string> = {};
  let iteration: Iteration | null = null;
  for (const v of item.fieldValues.nodes) {
    if (!v || !v.field || !v.field.name) continue;
    if (v.name !== undefined) singleSelect[v.field.name] = v.name;
    if (v.date !== undefined) dates[v.field.name] = v.date;
    if (v.startDate !== undefined && v.field.name === ITERATION_FIELD) {
      iteration = {
        title: v.title ?? "",
        startDate: v.startDate,
        duration: v.duration ?? 0,
      };
    }
  }

  const dueRaw = dates[DUE_DATE_FIELD];
  return {
    type: c.__typename,
    number: c.number ?? null,
    title: c.title,
    url: c.url ?? null,
    assignees: (c.assignees?.nodes ?? []).map((a) => a.login),
    updatedAt: c.updatedAt ? new Date(c.updatedAt) : null,
    closedAt: c.closedAt ? new Date(c.closedAt) : null,
    status: singleSelect[STATUS_FIELD] ?? null,
    priority: singleSelect[PRIORITY_FIELD] ?? null,
    dueDate: dueRaw ? new Date(dueRaw) : null,
    iteration,
  };
}

// The iteration (Target version) whose date range contains today, from the field config.
function currentIterationFromConfig(
  config: IterationConfig | null
): Iteration | null {
  if (!config) return null;
  const all: Iteration[] = [
    ...(config.iterations ?? []),
    ...(config.completedIterations ?? []),
  ];
  const now = Date.now();
  return (
    all.find((i) => {
      const start = new Date(i.startDate).getTime();
      const end = iterationEnd(i)?.getTime() ?? Infinity;
      return now >= start && now < end;
    }) ?? null
  );
}

const isDone = (it: NormalizedItem): boolean =>
  (it.status !== null && DONE_STATUSES.includes(it.status)) ||
  it.closedAt !== null;
const isTodo = (it: NormalizedItem): boolean =>
  it.status !== null && TODO_STATUSES.includes(it.status);
const daysAgo = (date: Date): number => (Date.now() - date.getTime()) / 86400000;

// End date (exclusive) of an iteration = start + duration days.
function iterationEnd(
  iteration: { startDate?: string; duration?: number } | null | undefined
): Date | null {
  if (!iteration?.startDate) return null;
  const end = new Date(iteration.startDate);
  end.setUTCDate(end.getUTCDate() + (iteration.duration ?? 0));
  return end;
}

export function buildReport(
  title: string,
  allItems: NormalizedItem[],
  iterationConfig: IterationConfig | null
): Report {
  const sprint = currentIterationFromConfig(iterationConfig);

  // When scoping is on, only keep items assigned to the current Target version.
  const items =
    SCOPE_TO_CURRENT_ITERATION && sprint
      ? allItems.filter((it) => it.iteration?.title === sprint.title)
      : allItems;

  // Only count statuses that actually have items.
  const statusCounts: Record<string, number> = {};
  for (const it of items) {
    const key = it.status ?? NO_STATUS_LABEL;
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  const doneCount = items.filter(isDone).length;
  const progress = items.length
    ? Math.round((doneCount / items.length) * 100)
    : 0;

  const working = items.filter(
    (it) => !isDone(it) && !isTodo(it)
  ); // "In Progress" and similar active statuses

  const open = items.filter((it) => !isDone(it));
  const noAssignee = open.filter((it) => it.assignees.length === 0);
  const sprintEnd = iterationEnd(sprint);
  const overdue = open.filter(
    (it) => it.dueDate && it.dueDate.getTime() < Date.now()
  );
  const highPriority = open.filter(
    (it) => it.priority !== null && HIGH_PRIORITIES.includes(it.priority)
  );
  const stale = open.filter(
    (it) => it.updatedAt && daysAgo(it.updatedAt) > STALE_DAYS
  );

  return {
    title,
    sprint,
    sprintEnd,
    progress,
    total: items.length,
    statusCounts,
    working,
    attention: { noAssignee, overdue, highPriority, stale },
  };
}
