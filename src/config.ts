// Project field mapping & report behaviour.
// Adjust these to match your GitHub Project's field names and workflow —
// this is the only file you should need to touch when projects change.

// Shared field mapping, applied to every project below.
export const STATUS_FIELD = "Status";
export const ITERATION_FIELD = "Target version";
export const PRIORITY_FIELD = "Priority";
export const DUE_DATE_FIELD = "Due Date";

// Status option names that count as "done" / "not started".
// Annotated `readonly string[]` (not `as const`) on purpose: `as const` would
// narrow the element type and break `.includes(status: string)` callers.
export const DONE_STATUSES: readonly string[] = ["Done", "Closed"];
export const TODO_STATUSES: readonly string[] = ["Todo", "New", "Backlog"];

// Priority option names treated as high priority in the attention list.
export const HIGH_PRIORITIES: readonly string[] = ["High", "Urgent", "Immediate"];

// Flag items not updated for more than this many days.
export const STALE_DAYS = 3;

// ---------------------------------------------------------------------------
// Report wording — all user-facing text lives here so the report can be
// re-labelled (or localized) without touching report logic.
// ---------------------------------------------------------------------------

// Bucket label for items that have no Status field value.
export const NO_STATUS_LABEL = "No Status";

// Section headers used in the rendered report.
export const REPORT_LABELS = {
  reportTitle: "GitHub Project Daily Progress Report",
  overview: "📊 Sprint Overview",
  statusSummary: "Status Summary:",
  working: "🚧 Current Working Items",
  attention: "⚠️ Attention Items",
} as const;

// Only report items in the current iteration (Target version).
// Set env SCOPE=all to report on every item in the project instead.
export const SCOPE_TO_CURRENT_ITERATION = process.env.SCOPE !== "all";

// A project to report on, delivered to its own Slack channel.
// `projectIdEnv` / `webhookEnv` are the NAMES of environment variables (GitHub
// Actions secrets) holding the real values — keep secrets out of this file.
export interface ProjectTarget {
  name: string;
  projectIdEnv: string;
  webhookEnv: string;
}

// Projects to report on, each delivered to its own Slack channel.
// Add an entry per project; uncomment and fill the env names as you add secrets.
export const PROJECTS: ProjectTarget[] = [
  {
    name: "ERP Platform S-Asset",
    projectIdEnv: "PROJECT_ID",
    webhookEnv: "SLACK_WEBHOOK_URL",
  },
  {
    name: "ERP Platform S-WSM",
    projectIdEnv: "PROJECT_ID_B",
    webhookEnv: "SLACK_WEBHOOK_URL_B",
  },
  // {
  //   name: "Project C",
  //   projectIdEnv: "PROJECT_ID_C",
  //   webhookEnv: "SLACK_WEBHOOK_URL_C",
  // },
];
