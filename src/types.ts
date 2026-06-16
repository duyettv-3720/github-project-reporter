// Shared types for the daily project report — GraphQL response shapes and the
// flattened domain model the report is built from.

// Shape of the iteration (Target version) definitions, both in the field
// configuration and on individual items.
export interface Iteration {
  title: string;
  startDate: string;
  duration: number;
}

export interface IterationConfig {
  iterations?: Iteration[];
  completedIterations?: Iteration[];
}

// ---------------------------------------------------------------------------
// Partial GraphQL response — only the fields the query selects.
// ---------------------------------------------------------------------------

export interface RawAssignee {
  login: string;
}

export interface RawContent {
  __typename: string;
  number?: number;
  title: string;
  url?: string;
  updatedAt?: string;
  closedAt?: string | null;
  assignees?: { nodes: RawAssignee[] };
}

export interface RawFieldValue {
  name?: string;
  date?: string;
  title?: string;
  startDate?: string;
  duration?: number;
  field?: { name?: string } | null;
}

export interface RawItem {
  content: RawContent | null;
  fieldValues: { nodes: Array<RawFieldValue | null> };
}

export interface RawField {
  name?: string;
  configuration?: IterationConfig;
}

export interface RawProject {
  title: string;
  fields: { nodes: RawField[] };
  items: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: RawItem[];
  };
}

export interface QueryResult {
  node: RawProject | null;
}

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

// Flattened, report-friendly view of a project item.
export interface NormalizedItem {
  type: string;
  number: number | null;
  title: string;
  url: string | null;
  assignees: string[];
  updatedAt: Date | null;
  closedAt: Date | null;
  status: string | null;
  priority: string | null;
  dueDate: Date | null;
  iteration: Iteration | null;
}

export interface Attention {
  noAssignee: NormalizedItem[];
  overdue: NormalizedItem[];
  highPriority: NormalizedItem[];
  stale: NormalizedItem[];
}

export interface Report {
  title: string;
  sprint: Iteration | null;
  sprintEnd: Date | null;
  progress: number;
  total: number;
  statusCounts: Record<string, number>;
  working: NormalizedItem[];
  attention: Attention;
}

export interface SlackPayload {
  text: string;
}
