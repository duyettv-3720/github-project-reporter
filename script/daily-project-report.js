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
  PROJECTS,
} = require("./config");

const GH_TOKEN = process.env.GH_TOKEN;

if (!GH_TOKEN) {
  throw new Error("Missing GH_TOKEN");
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
async function fetchAllItems(projectId) {
  let cursor = null;
  let title = null;
  let iterationConfig = null;
  const rawItems = [];

  do {
    const res = await gh(QUERY, { projectId, cursor });
    const project = res.node;
    if (!project) {
      throw new Error(
        `Project not found for id="${projectId}". ` +
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

// Group items by their Status value, preserving first-seen order.
function groupByStatus(items) {
  const map = new Map();
  for (const it of items) {
    const key = it.status ?? "No Status";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return map;
}

// Full plain-text report. All sections are always shown (empty ones display a
// count of 0 rather than being hidden). Used for console output and, wrapped in
// a Slack code block, for the Slack message.
function renderReport(r) {
  const L = [];
  L.push("GitHub Project Daily Progress Report");
  L.push("");
  L.push("📊 Sprint Overview");
  L.push("");
  L.push(`Project: ${r.title}`);
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

  // Status Summary
  L.push("Status Summary:");
  const statusEntries = Object.entries(r.statusCounts);
  if (statusEntries.length) {
    statusEntries.forEach(([k, v]) => L.push(`• ${k}: ${v}`));
  } else {
    L.push("• (no items)");
  }
  L.push("");

  // Current Working Items, grouped by status
  L.push("🚧 Current Working Items");
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

  // Attention Items — every sub-section always shown with its count
  const a = r.attention;
  L.push("⚠️ Attention Items");
  L.push("");
  const block = (label, items, fmt) => {
    L.push(`• ${label} (${items.length})`);
    items.forEach((it) => L.push(`  - ${fmt ? fmt(it) : itemLabel(it)}`));
  };
  block("No Assignee", a.noAssignee);
  block("Overdue", a.overdue, (it) => `${itemLabel(it)} (due ${fmtDate(it.dueDate)})`);
  block("High Priority Open", a.highPriority, (it) => `${itemLabel(it)} [${it.priority}]`);
  block(`No Update > ${STALE_DAYS} days`, a.stale);

  return L.join("\n");
}

// Wrap the report text in a Slack code block so it renders monospace.
const toSlackPayload = (r) => ({ text: "```\n" + renderReport(r) + "\n```" });

async function sendToSlack(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}

// Build and deliver the report for a single configured project.
async function runProject(target) {
  const projectId = process.env[target.projectIdEnv];
  const webhookUrl = process.env[target.webhookEnv];

  if (!projectId) {
    console.warn(`⏭️  ${target.name}: ${target.projectIdEnv} not set — skipping.`);
    return;
  }

  const { title, items, iterationConfig } = await fetchAllItems(projectId);
  const report = buildReport(title, items, iterationConfig);

  if (webhookUrl) {
    await sendToSlack(webhookUrl, toSlackPayload(report));
    console.log(`✅ ${target.name}: report sent to Slack.`);
  } else {
    console.log(`ℹ️  ${target.name}: ${target.webhookEnv} not set — printing report (dry-run):\n`);
    console.log(renderReport(report));
    console.log("");
  }
}

async function main() {
  if (!PROJECTS.length) {
    throw new Error("No projects configured in config.js (PROJECTS is empty).");
  }

  let failures = 0;
  for (const target of PROJECTS) {
    try {
      await runProject(target);
    } catch (error) {
      failures++;
      console.error(`❌ ${target.name}: ${error.message ?? error}`);
    }
  }

  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
