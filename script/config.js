// Project field mapping & report behaviour.
// Adjust these to match your GitHub Project's field names and workflow —
// this is the only file you should need to touch when the project changes.
module.exports = {
  // Names of the project fields, exactly as they appear in GitHub.
  STATUS_FIELD: "Status",
  ITERATION_FIELD: "Target version",
  PRIORITY_FIELD: "Priority",
  DUE_DATE_FIELD: "Due Date",

  // Status option names that count as "done" / "not started".
  DONE_STATUSES: ["Done", "Closed"],
  TODO_STATUSES: ["Todo", "New", "Backlog"],

  // Priority option names treated as high priority in the attention list.
  HIGH_PRIORITIES: ["High", "Urgent", "Immediate"],

  // Flag items not updated for more than this many days.
  STALE_DAYS: 3,

  // Only report items in the current iteration (Target version).
  // Set env SCOPE=all to report on every item in the project instead.
  SCOPE_TO_CURRENT_ITERATION: process.env.SCOPE !== "all",
};
