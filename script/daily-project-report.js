const { graphql } = require("@octokit/graphql");
const {
  STATUS_FIELD,
  ITERATION_FIELD,
  PRIORITY_FIELD,
  DUE_DATE_FIELD,
  DONE_STATUSES,
  TODO_STATUSES,
  HIGH_PRIORITIES,
  STALE_DAYS,
  SCOPE_TO_CURRENT_ITERATION,
} = require("./config");

const GH_TOKEN = process.env.GH_TOKEN;
const PROJECT_ID = process.env.PROJECT_ID;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL; // optional: dry-run to console if unset

if (!GH_TOKEN || !PROJECT_ID) {
  throw new Error("Missing GH_TOKEN or PROJECT_ID");
}

const gh = graphql.defaults({
  headers: {
    authorization: `Bearer ${GH_TOKEN}`,
  },
});

const QUERY = `
  query($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        title
        fields(first: 30) {
          nodes {
            ... on ProjectV2IterationField {
              name
              configuration {
                iterations { title startDate duration }
                completedIterations { title startDate duration }
              }
            }
          }
        }
        items(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            content {
              __typename
              ... on Issue {
                number title url updatedAt closedAt
                assignees(first: 5) { nodes { login } }
              }
              ... on PullRequest {
                number title url updatedAt closedAt
                assignees(first: 5) { nodes { login } }
              }
              ... on DraftIssue { title updatedAt }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title startDate duration
                  field { ... on ProjectV2IterationField { name } }
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  field { ... on ProjectV2FieldCommon { name } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Fetch every page of project items, following the GraphQL cursor.
async function fetchAllItems() {
  let cursor = null;
  let title = null;
  let iterationConfig = null;
  const rawItems = [];

  do {
    const res = await gh(QUERY, { projectId: PROJECT_ID, cursor });
    const project = res.node;
    if (!project) {
      throw new Error(
        `Project not found for PROJECT_ID="${PROJECT_ID}". ` +
          "Check the ID is a ProjectV2 node ID and the token has access."
      );
    }
    title = project.title;
    if (!iterationConfig) {
      const field = project.fields.nodes.find(
        (f) => f.name === ITERATION_FIELD && f.configuration
      );
      iterationConfig = field?.configuration ?? null;
    }
    rawItems.push(...project.items.nodes);
    cursor = project.items.pageInfo.hasNextPage
      ? project.items.pageInfo.endCursor
      : null;
  } while (cursor);

  return {
    title,
    iterationConfig,
    items: rawItems.map(normalizeItem).filter(Boolean),
  };
}

// The iteration (Target version) whose date range contains today, from the field config.
function currentIterationFromConfig(config) {
  if (!config) return null;
  const all = [
    ...(config.iterations ?? []),
    ...(config.completedIterations ?? []),
  ];
  const now = Date.now();
  return (
    all.find((i) => {
      const start = new Date(i.startDate).getTime();
      const end = iterationEnd(i).getTime();
      return now >= start && now < end;
    }) ?? null
  );
}

// Flatten a raw project item into a plain shape that's easy to report on.
function normalizeItem(item) {
  const c = item.content;
  if (!c) return null;

  const singleSelect = {};
  const dates = {};
  let iteration = null;
  for (const v of item.fieldValues.nodes) {
    if (!v || !v.field) continue;
    if (v.name !== undefined) singleSelect[v.field.name] = v.name;
    if (v.date !== undefined) dates[v.field.name] = v.date;
    if (v.startDate !== undefined && v.field.name === ITERATION_FIELD) {
      iteration = { title: v.title, startDate: v.startDate, duration: v.duration };
    }
  }

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
    dueDate: dates[DUE_DATE_FIELD] ? new Date(dates[DUE_DATE_FIELD]) : null,
    iteration,
  };
}

const isDone = (it) => DONE_STATUSES.includes(it.status) || it.closedAt;
const isTodo = (it) => TODO_STATUSES.includes(it.status);
const daysAgo = (date) => (Date.now() - date.getTime()) / 86400000;

// End date (exclusive) of an iteration = start + duration days.
function iterationEnd(iteration) {
  if (!iteration?.startDate) return null;
  const end = new Date(iteration.startDate);
  end.setUTCDate(end.getUTCDate() + (iteration.duration ?? 0));
  return end;
}

const fmtDate = (d) =>
  d
    ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(
        d.getUTCMonth() + 1
      ).padStart(2, "0")}/${d.getUTCFullYear()}`
    : "-";

function buildReport(title, allItems, iterationConfig) {
  const sprint = currentIterationFromConfig(iterationConfig);

  // When scoping is on, only keep items assigned to the current Target version.
  const items =
    SCOPE_TO_CURRENT_ITERATION && sprint
      ? allItems.filter((it) => it.iteration?.title === sprint.title)
      : allItems;

  const statusCounts = {};
  for (const it of items) {
    const key = it.status ?? "No Status";
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
  const highPriority = open.filter((it) => HIGH_PRIORITIES.includes(it.priority));
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

const itemLabel = (it) => {
  const who = it.assignees.length ? ` (@${it.assignees.join(", @")})` : "";
  const num = it.number ? `#${it.number} ` : "";
  return `${num}${it.title}${who}`;
};

// --- Slack Block Kit payload ---
function toSlackBlocks(r) {
  const blocks = [];
  const sec = (text) => blocks.push({ type: "section", text: { type: "mrkdwn", text } });

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "📊 GitHub Project Daily Report", emoji: true },
  });

  const overview = [
    `*Project:* ${r.title}`,
    r.sprint ? `*Sprint:* ${r.sprint.title} (${fmtDate(new Date(r.sprint.startDate))} → ${fmtDate(r.sprintEnd)})` : "*Sprint:* (no active Target version)",
    `*Progress:* ${r.progress}% (${r.total} items)`,
    r.sprintEnd ? `*Due Date:* ${fmtDate(r.sprintEnd)}` : null,
  ].filter(Boolean).join("\n");
  sec(overview);

  if (r.total === 0) {
    sec("_No items assigned to the current Target version._");
    return { blocks };
  }

  const statusLines = Object.entries(r.statusCounts)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");
  sec(`*Status Summary:*\n${statusLines}`);

  if (r.working.length) {
    sec(`*🚧 Current Working Items:*\n${r.working.map((it) => `• ${itemLabel(it)}`).join("\n")}`);
  }

  const a = r.attention;
  const attentionParts = [];
  if (a.noAssignee.length)
    attentionParts.push(`*No Assignee (${a.noAssignee.length}):*\n${a.noAssignee.map((it) => `  - ${itemLabel(it)}`).join("\n")}`);
  if (a.overdue.length)
    attentionParts.push(`*Overdue (${a.overdue.length}):*\n${a.overdue.map((it) => `  - ${itemLabel(it)} (due ${fmtDate(it.dueDate)})`).join("\n")}`);
  if (a.highPriority.length)
    attentionParts.push(`*High Priority Open (${a.highPriority.length}):*\n${a.highPriority.map((it) => `  - ${itemLabel(it)} [${it.priority}]`).join("\n")}`);
  if (a.stale.length)
    attentionParts.push(`*No Update > ${STALE_DAYS} days (${a.stale.length}):*\n${a.stale.map((it) => `  - ${itemLabel(it)}`).join("\n")}`);
  if (attentionParts.length) {
    blocks.push({ type: "divider" });
    sec(`*⚠️ Attention Items*\n\n${attentionParts.join("\n\n")}`);
  }

  return { blocks };
}

// Plain-text version for console dry-run.
function toText(r) {
  const lines = ["📊 GitHub Project Daily Report", ""];
  lines.push(`Project: ${r.title}`);
  lines.push(`Sprint: ${r.sprint ? `${r.sprint.title} (${fmtDate(new Date(r.sprint.startDate))} - ${fmtDate(r.sprintEnd)})` : "(no active Target version)"}`);
  lines.push(`Progress: ${r.progress}% (${r.total} items)`);
  if (r.sprintEnd) lines.push(`Due Date: ${fmtDate(r.sprintEnd)}`);
  if (r.total === 0) {
    lines.push("", "No items assigned to the current Target version.");
    return lines.join("\n");
  }
  lines.push("", "Status Summary:");
  for (const [k, v] of Object.entries(r.statusCounts)) lines.push(`  • ${k}: ${v}`);
  if (r.working.length) {
    lines.push("", "🚧 Current Working Items:");
    r.working.forEach((it) => lines.push(`  • ${itemLabel(it)}`));
  }
  const a = r.attention;
  if (a.noAssignee.length || a.overdue.length || a.highPriority.length || a.stale.length) {
    lines.push("", "⚠️ Attention Items:");
    if (a.noAssignee.length) { lines.push(`  No Assignee (${a.noAssignee.length}):`); a.noAssignee.forEach((it) => lines.push(`    - ${itemLabel(it)}`)); }
    if (a.overdue.length) { lines.push(`  Overdue (${a.overdue.length}):`); a.overdue.forEach((it) => lines.push(`    - ${itemLabel(it)} (due ${fmtDate(it.dueDate)})`)); }
    if (a.highPriority.length) { lines.push(`  High Priority Open (${a.highPriority.length}):`); a.highPriority.forEach((it) => lines.push(`    - ${itemLabel(it)} [${it.priority}]`)); }
    if (a.stale.length) { lines.push(`  No Update > ${STALE_DAYS} days (${a.stale.length}):`); a.stale.forEach((it) => lines.push(`    - ${itemLabel(it)}`)); }
  }
  return lines.join("\n");
}

async function sendToSlack(payload) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const { title, items, iterationConfig } = await fetchAllItems();
  const report = buildReport(title, items, iterationConfig);

  if (SLACK_WEBHOOK_URL) {
    await sendToSlack(toSlackBlocks(report));
    console.log("✅ Report sent to Slack.");
  } else {
    console.log("ℹ️  SLACK_WEBHOOK_URL not set — printing report (dry-run):\n");
    console.log(toText(report));
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
