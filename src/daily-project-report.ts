// Entry point: fetch each configured project from GitHub, build its report,
// and deliver it to Slack (or print a dry-run when no webhook is set).

import { graphql } from "@octokit/graphql";
import { ITERATION_FIELD, PROJECTS, type ProjectTarget } from "./config";
import type {
  IterationConfig,
  NormalizedItem,
  QueryResult,
  RawItem,
  RawProject,
  SlackPayload,
} from "./types";
import { buildReport, normalizeItem } from "./report-builder";
import { renderReport, toSlackPayload } from "./report-renderer";

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
async function fetchAllItems(projectId: string): Promise<{
  title: string;
  iterationConfig: IterationConfig | null;
  items: NormalizedItem[];
}> {
  let cursor: string | null = null;
  let title = "";
  let iterationConfig: IterationConfig | null = null;
  const rawItems: RawItem[] = [];

  do {
    const res: QueryResult = await gh<QueryResult>(QUERY, { projectId, cursor });
    const project: RawProject | null = res.node;
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
    items: rawItems
      .map(normalizeItem)
      .filter((it): it is NormalizedItem => it !== null),
  };
}

async function sendToSlack(
  webhookUrl: string,
  payload: SlackPayload
): Promise<void> {
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
async function runProject(target: ProjectTarget): Promise<void> {
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

async function main(): Promise<void> {
  if (!PROJECTS.length) {
    throw new Error("No projects configured in config.ts (PROJECTS is empty).");
  }

  let failures = 0;
  for (const target of PROJECTS) {
    try {
      await runProject(target);
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${target.name}: ${message}`);
    }
  }

  if (failures) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
