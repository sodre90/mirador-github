import type { PromptKind, PromptOverrides, PromptScope } from "./prompts.ts";
import type { RemoteCandidate, RepoRef } from "./remote.ts";

export type ItemKind = "pr" | "issue";

export type ItemState = "open" | "closed" | "merged" | "draft";

export interface Label {
  name: string;
  /** Six hex digits, without the #. */
  color: string;
}

/** The combined state of a PR's checks. */
export interface ChecksSummary {
  passed: number;
  failed: number;
  pending: number;
  total: number;
}

export type ReviewDecision = "approved" | "changes-requested" | "review-required" | null;

/** A row of a list: what an issue or PR shows before it is opened. */
export interface ListItem {
  kind: ItemKind;
  number: number;
  title: string;
  state: ItemState;
  /** Why a closed issue closed: completed, not planned or a duplicate. */
  stateReason: string | null;
  author: string;
  labels: Label[];
  assignees: string[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  /** PRs only. */
  headRef?: string;
  baseRef?: string;
  checks?: ChecksSummary;
  review?: ReviewDecision;
  reviewRequested?: string[];
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  /** Issues only. */
  subIssues?: { done: number; total: number };
  linkedPrs?: number[];
}

export interface Check {
  name: string;
  /** passed, failed, pending, or skipped, as the row's mark. */
  state: "passed" | "failed" | "pending" | "skipped";
  url: string | null;
  workflow: string | null;
  completedAt: string | null;
}

/** A comment, or a review that said something or decided something, in the order they happened. */
export interface TimelineEntry {
  kind: "comment" | "review";
  author: string;
  body: string;
  at: string;
  /** Reviews only: approved, changes-requested or commented. */
  verdict?: "approved" | "changes-requested" | "commented" | "dismissed";
  url: string | null;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface Detail extends ListItem {
  body: string;
  milestone: string | null;
  timeline: TimelineEntry[];
  /** PRs only. */
  checkList?: Check[];
  files?: ChangedFile[];
  commits?: number;
  mergeable?: "mergeable" | "conflicting" | "unknown";
  closesIssues?: number[];
  crossRepository?: boolean;
  /** Issues only. */
  subIssueList?: { number: number; title: string; state: ItemState }[];
}

export type GhProblemCode = "not-installed" | "not-signed-in" | "not-found" | "rate-limited" | "offline" | "failed";

export interface GhProblem {
  code: GhProblemCode;
  /** gh's own words, for the user to read. */
  message: string;
  /** The server gh needs to sign in to, for not-signed-in. */
  host?: string;
}

export interface ListResult {
  items: ListItem[];
  fetchedAt: number | null;
  problem: GhProblem | null;
}

export interface DetailResult {
  detail: Detail | null;
  fetchedAt: number | null;
  problem: GhProblem | null;
}

export interface SavedView {
  name: string;
  query: string;
}

export interface RepoMeta {
  viewer: string | null;
  labels: Label[];
  assignable: string[];
  mergeMethods: MergeMethod[];
  deleteBranchOnMerge: boolean;
  defaultBranch: string | null;
  canPush: boolean;
}

export type MergeMethod = "squash" | "merge" | "rebase";

/** What the view remembers between visits, for this workspace. */
export interface Prefs {
  kind: ItemKind;
  query: Record<ItemKind, string>;
}

/** Everything the tab shows for one workspace. */
export interface TabState {
  connection: RepoRef | null;
  /** The workspace's remotes that point at GitHub, offered to connect to while it isn't. */
  candidates: RemoteCandidate[];
  /** A problem with gh itself, which keeps everything from loading. */
  problem: GhProblem | null;
  /** The branch checked out in the workspace, and its PR in the repository, if any. */
  branch: string | null;
  branchPr: ListItem | null;
  meta: RepoMeta | null;
  /** By listKey. */
  lists: Record<string, ListResult>;
  /** How many items each view's query finds, by listKey. */
  counts: Record<string, number>;
  /** By detailKey. */
  details: Record<string, DetailResult>;
  savedViews: Record<ItemKind, SavedView[]>;
  prefs: Prefs;
  prompts: PromptOverrides;
  /** The lists and details being fetched now, by their keys. */
  loading: string[];
}

export const listKey = (kind: ItemKind, query: string) => `${kind}:${query.trim()}`;

export const detailKey = (kind: ItemKind, number: number) => `${kind}#${number}`;

/** What the view sends the host. */
export type TabAction =
  | { kind: "connect"; repo: string }
  | { kind: "disconnect" }
  | { kind: "refresh"; list: { kind: ItemKind; query: string } | null; counts: ItemKind | null }
  | { kind: "open"; item: ItemKind; number: number }
  | { kind: "prefs"; prefs: Prefs }
  | { kind: "save-view"; item: ItemKind; name: string; query: string }
  | { kind: "remove-view"; item: ItemKind; name: string }
  | { kind: "comment"; item: ItemKind; number: number; body: string; close: boolean }
  | { kind: "set-state"; item: ItemKind; number: number; open: boolean; reason?: "completed" | "not planned" }
  | { kind: "merge"; number: number; method: MergeMethod; deleteBranch: boolean }
  | { kind: "review"; number: number; verdict: "approve" | "request-changes" | "comment"; body: string }
  | { kind: "labels"; item: ItemKind; number: number; add: string[]; remove: string[] }
  | { kind: "assignees"; item: ItemKind; number: number; add: string[]; remove: string[] }
  | { kind: "ready"; number: number; ready: boolean }
  | { kind: "checkout"; number: number; evenIfChanged: boolean }
  | { kind: "create-issue"; title: string; body: string }
  | { kind: "set-prompt"; scope: PromptScope; prompt: PromptKind; text: string | null };

/** What a checkout answers: done, or the working tree's changes it would stand on, for the user to decide. */
export type CheckoutReply = { checkedOut: true; branch: string | null } | { checkedOut: false; changedFiles: string[] };
