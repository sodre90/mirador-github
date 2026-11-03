import type { ChangedFile, Check, ChecksSummary, Detail, ItemKind, ItemState, Label, ListItem, ReviewDecision, TimelineEntry } from "./model.ts";

/** The fields asked of `gh pr list` and `gh pr view` for a row. */
export const PR_LIST_FIELDS = [
  "number",
  "title",
  "state",
  "isDraft",
  "author",
  "labels",
  "assignees",
  "comments",
  "createdAt",
  "updatedAt",
  "url",
  "headRefName",
  "baseRefName",
  "reviewDecision",
  "reviewRequests",
  "statusCheckRollup",
  "additions",
  "deletions",
  "changedFiles",
];

export const PR_DETAIL_FIELDS = [...PR_LIST_FIELDS, "body", "milestone", "reviews", "files", "commits", "mergeable", "closingIssuesReferences", "isCrossRepository"];

export const ISSUE_LIST_FIELDS = ["number", "title", "state", "stateReason", "author", "labels", "assignees", "comments", "createdAt", "updatedAt", "url", "subIssuesSummary", "closedByPullRequestsReferences"];

export const ISSUE_DETAIL_FIELDS = [...ISSUE_LIST_FIELDS, "body", "milestone", "subIssues"];

type Json = Record<string, unknown>;

const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const login = (value: unknown) => text(record(value).login) || "ghost";

const labelsOf = (value: unknown): Label[] => list(value).map((label) => ({ name: text(record(label).name), color: text(record(label).color) || "888888" }));

const assigneesOf = (value: unknown) => list(value).map(login);

/** A comment count: gh lists the comments themselves, which only their number is kept of. */
const commentCount = (value: unknown) => (Array.isArray(value) ? value.length : count(record(value).totalCount));

const stateOf = (kind: ItemKind, json: Json): ItemState => {
  const state = text(json.state).toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return kind === "pr" && json.isDraft === true ? "draft" : "open";
};

/** A check run's or a status context's mark. */
export function checkStateOf(check: Json): Check["state"] {
  const conclusion = text(check.conclusion).toUpperCase();
  const status = text(check.status).toUpperCase();
  const contextState = text(check.state).toUpperCase();
  if (check.__typename === "StatusContext" || (contextState && !status)) {
    if (contextState === "SUCCESS") return "passed";
    if (contextState === "FAILURE" || contextState === "ERROR") return "failed";
    return "pending";
  }
  if (status && status !== "COMPLETED") return "pending";
  if (["SUCCESS", "NEUTRAL"].includes(conclusion)) return "passed";
  if (["SKIPPED", "STALE"].includes(conclusion)) return "skipped";
  if (conclusion === "") return "pending";
  return "failed";
}

export const checksOf = (rollup: unknown): Check[] =>
  list(rollup).map((entry) => {
    const check = record(entry);
    return {
      name: text(check.name) || text(check.context) || "check",
      state: checkStateOf(check),
      url: text(check.detailsUrl) || text(check.targetUrl) || null,
      workflow: text(check.workflowName) || null,
      completedAt: text(check.completedAt) || null,
    };
  });

export function summaryOf(checks: Check[]): ChecksSummary {
  const counted = checks.filter(({ state }) => state !== "skipped");
  return {
    passed: counted.filter(({ state }) => state === "passed").length,
    failed: counted.filter(({ state }) => state === "failed").length,
    pending: counted.filter(({ state }) => state === "pending").length,
    total: counted.length,
  };
}

const reviewDecisionOf = (value: unknown): ReviewDecision =>
  ({ APPROVED: "approved", CHANGES_REQUESTED: "changes-requested", REVIEW_REQUIRED: "review-required" } as const)[text(value) as "APPROVED"] ?? null;

const requestedOf = (value: unknown) => list(value).map((request) => text(record(request).login) || text(record(request).name) || text(record(request).slug)).filter(Boolean);

const numbersOf = (value: unknown) => list(value).map((reference) => count(record(reference).number)).filter((number) => number > 0);

export function prItem(json: Json): ListItem {
  return {
    kind: "pr",
    number: count(json.number),
    title: text(json.title),
    state: stateOf("pr", json),
    stateReason: null,
    author: login(json.author),
    labels: labelsOf(json.labels),
    assignees: assigneesOf(json.assignees),
    comments: commentCount(json.comments),
    createdAt: text(json.createdAt),
    updatedAt: text(json.updatedAt),
    url: text(json.url),
    headRef: text(json.headRefName),
    baseRef: text(json.baseRefName),
    checks: summaryOf(checksOf(json.statusCheckRollup)),
    review: reviewDecisionOf(json.reviewDecision),
    reviewRequested: requestedOf(json.reviewRequests),
    additions: count(json.additions),
    deletions: count(json.deletions),
    changedFiles: count(json.changedFiles),
  };
}

export function issueItem(json: Json): ListItem {
  const sub = record(json.subIssuesSummary);
  return {
    kind: "issue",
    number: count(json.number),
    title: text(json.title),
    state: stateOf("issue", json),
    stateReason: text(json.stateReason).toLowerCase().replaceAll("_", " ") || null,
    author: login(json.author),
    labels: labelsOf(json.labels),
    assignees: assigneesOf(json.assignees),
    comments: commentCount(json.comments),
    createdAt: text(json.createdAt),
    updatedAt: text(json.updatedAt),
    url: text(json.url),
    subIssues: { done: count(sub.completed), total: count(sub.total) },
    linkedPrs: numbersOf(json.closedByPullRequestsReferences),
  };
}

const commentsOf = (value: unknown): TimelineEntry[] =>
  list(value).map((entry) => {
    const comment = record(entry);
    return { kind: "comment", author: login(comment.author), body: text(comment.body), at: text(comment.createdAt), url: text(comment.url) || null };
  });

const verdictOf = (state: string): TimelineEntry["verdict"] =>
  ({ APPROVED: "approved", CHANGES_REQUESTED: "changes-requested", DISMISSED: "dismissed" } as const)[state as "APPROVED"] ?? "commented";

/** Reviews that decided something, or said something; a bare "commented" with no words is only noise. */
const reviewsOf = (value: unknown): TimelineEntry[] =>
  list(value).flatMap((entry) => {
    const review = record(entry);
    const verdict = verdictOf(text(review.state));
    const body = text(review.body);
    if (verdict === "commented" && !body.trim()) return [];
    return [{ kind: "review" as const, author: login(review.author), body, at: text(review.submittedAt), verdict, url: null }];
  });

const byTime = (a: TimelineEntry, b: TimelineEntry) => a.at.localeCompare(b.at);

const filesOf = (value: unknown): ChangedFile[] =>
  list(value).map((entry) => {
    const file = record(entry);
    return { path: text(file.path), additions: count(file.additions), deletions: count(file.deletions) };
  });

const mergeableOf = (value: unknown): Detail["mergeable"] => ({ MERGEABLE: "mergeable", CONFLICTING: "conflicting" } as const)[text(value) as "MERGEABLE"] ?? "unknown";

export function prDetail(json: Json): Detail {
  return {
    ...prItem(json),
    body: text(json.body),
    milestone: text(record(json.milestone).title) || null,
    timeline: [...commentsOf(json.comments), ...reviewsOf(json.reviews)].sort(byTime),
    checkList: checksOf(json.statusCheckRollup),
    files: filesOf(json.files),
    commits: list(json.commits).length,
    mergeable: mergeableOf(json.mergeable),
    closesIssues: numbersOf(json.closingIssuesReferences),
    crossRepository: json.isCrossRepository === true,
  };
}

export function issueDetail(json: Json): Detail {
  return {
    ...issueItem(json),
    body: text(json.body),
    milestone: text(record(json.milestone).title) || null,
    timeline: commentsOf(json.comments).sort(byTime),
    subIssueList: list(record(json.subIssues).nodes).map((entry) => {
      const sub = record(entry);
      return { number: count(sub.number), title: text(sub.title), state: stateOf("issue", sub) };
    }),
  };
}
