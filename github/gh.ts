import type { GhProblem, ItemKind, MergeMethod, TabAction } from "./model.ts";
import { ISSUE_DETAIL_FIELDS, ISSUE_LIST_FIELDS, PR_DETAIL_FIELDS, PR_LIST_FIELDS } from "./normalize.ts";
import { GITHUB_COM, repoArg, type RepoRef } from "./remote.ts";
import { ProgramMissing, type Ran } from "./run.ts";

export const LIST_LIMIT = 50;

const ghKind = (kind: ItemKind) => (kind === "pr" ? "pr" : "issue");

export const listArgs = (repo: RepoRef, kind: ItemKind, query: string) => [
  ghKind(kind),
  "list",
  "-R",
  repoArg(repo),
  "--state",
  "all",
  "--limit",
  String(LIST_LIMIT),
  ...(query.trim() ? ["--search", query.trim()] : []),
  "--json",
  (kind === "pr" ? PR_LIST_FIELDS : ISSUE_LIST_FIELDS).join(","),
];

export const viewArgs = (repo: RepoRef, kind: ItemKind, number: number | string) => [
  ghKind(kind),
  "view",
  String(number),
  "-R",
  repoArg(repo),
  "--json",
  (kind === "pr" ? PR_DETAIL_FIELDS : ISSUE_DETAIL_FIELDS).join(","),
];

export const branchPrArgs = (repo: RepoRef, branch: string) => ["pr", "view", branch, "-R", repoArg(repo), "--json", PR_LIST_FIELDS.join(",")];

const hostArgs = (repo: RepoRef) => (repo.host === GITHUB_COM ? [] : ["--hostname", repo.host]);

/** One GraphQL search per query, by alias, so every view's count comes in one call. */
export function countsArgs(repo: RepoRef, kind: ItemKind, queries: string[]) {
  const type = kind === "pr" ? "is:pr" : "is:issue";
  const fields = queries.map((query, index) => `q${index}: search(type: ISSUE, query: ${JSON.stringify(`repo:${repo.owner}/${repo.name} ${type} ${query}`.trim())}) { issueCount }`);
  return ["api", "graphql", ...hostArgs(repo), "-f", `query=query { ${fields.join(" ")} }`];
}

export const viewerArgs = (repo: RepoRef) => ["api", "user", ...hostArgs(repo), "--jq", ".login"];

export const repoMetaArgs = (repo: RepoRef) => [
  "repo",
  "view",
  repoArg(repo),
  "--json",
  "assignableUsers,viewerPermission,defaultBranchRef,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,deleteBranchOnMerge",
];

export const labelsArgs = (repo: RepoRef) => ["label", "list", "-R", repoArg(repo), "--limit", "200", "--json", "name,color"];

const mergeFlag: Record<MergeMethod, string> = { squash: "--squash", merge: "--merge", rebase: "--rebase" };

type WriteAction = Extract<TabAction, { kind: "comment" | "set-state" | "merge" | "review" | "labels" | "assignees" | "ready" | "create-issue" }>;

/** The gh command a write runs, which the view shows the user before they confirm it. */
export function writeArgs(repo: RepoRef, action: WriteAction): string[] {
  const R = ["-R", repoArg(repo)];
  switch (action.kind) {
    case "comment":
      if (action.close) return [ghKind(action.item), "close", String(action.number), ...R, "--comment", action.body, ...(action.item === "issue" ? ["--reason", "completed"] : [])];
      return [ghKind(action.item), "comment", String(action.number), ...R, "--body", action.body];
    case "set-state":
      if (action.open) return [ghKind(action.item), "reopen", String(action.number), ...R];
      return [ghKind(action.item), "close", String(action.number), ...R, ...(action.item === "issue" && action.reason ? ["--reason", action.reason] : [])];
    case "merge":
      return ["pr", "merge", String(action.number), ...R, mergeFlag[action.method], ...(action.deleteBranch ? ["--delete-branch"] : [])];
    case "review": {
      const verdict = { approve: "--approve", "request-changes": "--request-changes", comment: "--comment" }[action.verdict];
      return ["pr", "review", String(action.number), ...R, verdict, ...(action.body.trim() ? ["--body", action.body] : [])];
    }
    case "labels":
      return [ghKind(action.item), "edit", String(action.number), ...R, ...action.add.flatMap((label) => ["--add-label", label]), ...action.remove.flatMap((label) => ["--remove-label", label])];
    case "assignees":
      return [ghKind(action.item), "edit", String(action.number), ...R, ...action.add.flatMap((user) => ["--add-assignee", user]), ...action.remove.flatMap((user) => ["--remove-assignee", user])];
    case "ready":
      return ["pr", "ready", String(action.number), ...R, ...(action.ready ? [] : ["--undo"])];
    case "create-issue":
      return ["issue", "create", ...R, "--title", action.title, "--body", action.body];
  }
}

export const checkoutArgs = (repo: RepoRef, number: number) => ["pr", "checkout", String(number), "-R", repoArg(repo)];

const firstLine = (output: string) =>
  output
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";

/** What went wrong in gh's words, as the tab tells it: missing, not signed in, no such repository, limits, the network. */
export function problemOf(ran: Ran | ProgramMissing, host: string): GhProblem {
  if (ran instanceof ProgramMissing) return { code: "not-installed", message: ran.message };
  const said = `${ran.stderr}\n${ran.stdout}`;
  const message = firstLine(ran.stderr) || firstLine(ran.stdout) || `gh stopped with code ${ran.code}.`;
  if (/gh auth login|not logged in|authentication required|HTTP 401|Bad credentials|authenticate/i.test(said)) return { code: "not-signed-in", message, host };
  if (/rate limit/i.test(said)) return { code: "rate-limited", message };
  if (/Could not resolve to a (Repository|PullRequest|Issue)|HTTP 404|not found/i.test(said)) return { code: "not-found", message };
  if (/could not connect|dial tcp|no such host|i\/o timeout|network is unreachable|connection refused|TLS handshake/i.test(said)) return { code: "offline", message };
  return { code: "failed", message };
}

/** For the user to read before confirming: the command as a shell would take it. */
export function shellText(args: string[]) {
  const quoted = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);
  return ["gh", ...args.map((arg) => (arg.length > 80 ? `${quoted(arg.slice(0, 77))}…` : quoted(arg)))].join(" ");
}
