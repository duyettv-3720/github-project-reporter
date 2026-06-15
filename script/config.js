// Project field mapping & report behaviour.
// Adjust these to match your GitHub Project's field names and workflow —
// this is the only file you should need to touch when projects change.

// Shared field mapping, applied to every project below.
const STATUS_FIELD = "Status";
const ITERATION_FIELD = "Target version";
const PRIORITY_FIELD = "Priority";
const DUE_DATE_FIELD = "Due Date";

// Status option names that count as "done" / "not started".
const DONE_STATUSES = ["Done", "Closed"];
const TODO_STATUSES = ["Todo", "New", "Backlog"];

// Priority option names treated as high priority in the attention list.
const HIGH_PRIORITIES = ["High", "Urgent", "Immediate"];

// Flag items not updated for more than this many days.
const STALE_DAYS = 3;

// Only report items in the current iteration (Target version).
// Set env SCOPE=all to report on every item in the project instead.
const SCOPE_TO_CURRENT_ITERATION = process.env.SCOPE !== "all";

// Projects to report on, each delivered to its own Slack channel.
// `projectIdEnv` / `webhookEnv` are the NAMES of environment variables (GitHub
// Actions secrets) holding the real values — keep secrets out of this file.
// Add an entry per project; uncomment and fill the env names as you add secrets.
const PROJECTS = [
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

module.exports = {
  STATUS_FIELD,
  ITERATION_FIELD,
  PRIORITY_FIELD,
  DUE_DATE_FIELD,
  DONE_STATUSES,
  TODO_STATUSES,
  HIGH_PRIORITIES,
  STALE_DAYS,
  SCOPE_TO_CURRENT_ITERATION,
  PROJECTS,
};
