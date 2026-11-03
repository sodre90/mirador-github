import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceTab, WorkspaceTabContext } from "../mirador/api.ts";
import { branchPrArgs, checkoutArgs, countsArgs, labelsArgs, listArgs, problemOf, repoMetaArgs, viewArgs, viewerArgs, writeArgs } from "./gh.ts";
import {
  detailKey,
  listKey,
  type CheckoutReply,
  type DetailResult,
  type GhProblem,
  type ItemKind,
  type ListItem,
  type ListResult,
  type MergeMethod,
  type Prefs,
  type RepoMeta,
  type SavedView,
  type TabAction,
  type TabState,
} from "./model.ts";
import { issueDetail, issueItem, prDetail, prItem } from "./normalize.ts";
import { BUILT_IN_VIEWS, DEFAULT_QUERY } from "./query.ts";
import { parseRepo, remoteCandidates, type RemoteCandidate, type RepoRef } from "./remote.ts";
import { ProgramMissing, spawnRunner, type Ran, type Runner } from "./run.ts";

const KEPT_LISTS = 12;
const KEPT_DETAILS = 20;

/** Problems that keep gh from answering anything, which the whole tab shows, rather than the list that met them. */
const BLOCKING: GhProblem["code"][] = ["not-installed", "not-signed-in"];

/** What the tab knows of a workspace while Mirador runs: what gh last answered, and what it is fetching now. */
interface WorkspaceCache {
  candidates: RemoteCandidate[] | null;
  problem: GhProblem | null;
  branch: string | null;
  branchPr: ListItem | null;
  meta: RepoMeta | null;
  lists: Map<string, ListResult>;
  counts: Record<string, number>;
  details: Map<string, DetailResult>;
  loading: Set<string>;
  fetching: Map<string, Promise<unknown>>;
}

const emptyCache = (): WorkspaceCache => ({
  candidates: null,
  problem: null,
  branch: null,
  branchPr: null,
  meta: null,
  lists: new Map(),
  counts: {},
  details: new Map(),
  loading: new Set(),
  fetching: new Map(),
});

/** Newest last, so the oldest goes first when there are too many. */
const keepNewest = <Value>(map: Map<string, Value>, key: string, value: Value, most: number) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > most) map.delete(map.keys().next().value!);
};

class GhFailed extends Error {
  constructor(readonly problem: GhProblem) {
    super(problem.message);
  }
}

const isRepo = (value: unknown): value is RepoRef =>
  !!value && typeof value === "object" && ["host", "owner", "name"].every((key) => typeof (value as Record<string, unknown>)[key] === "string");

const savedViewsOf = (value: unknown): Record<ItemKind, SavedView[]> => {
  const stored = (value && typeof value === "object" ? value : {}) as Partial<Record<ItemKind, SavedView[]>>;
  return { pr: Array.isArray(stored.pr) ? stored.pr : [], issue: Array.isArray(stored.issue) ? stored.issue : [] };
};

const prefsOf = (value: unknown): Prefs => {
  const stored = (value && typeof value === "object" ? value : {}) as Partial<Prefs>;
  return { kind: stored.kind === "issue" ? "issue" : "pr", query: { ...DEFAULT_QUERY, ...(stored.query ?? {}) } };
};

const mergeMethodsOf = (repo: Record<string, unknown>): MergeMethod[] =>
  (
    [
      ["squash", repo.squashMergeAllowed],
      ["merge", repo.mergeCommitAllowed],
      ["rebase", repo.rebaseMergeAllowed],
    ] as const
  ).flatMap(([method, allowed]) => (allowed === false ? [] : [method]));

/** The GitHub tab of every workspace: what Mirador asks of it, and the user's actions in it. */
export class GitHubTab implements WorkspaceTab<TabState> {
  private readonly caches = new Map<string, WorkspaceCache>();

  constructor(private readonly run: Runner = spawnRunner) {}

  private cacheOf(context: WorkspaceTabContext) {
    const known = this.caches.get(context.workspace.id);
    if (known) return known;
    const cache = emptyCache();
    this.caches.set(context.workspace.id, cache);
    return cache;
  }

  private connectionOf(context: WorkspaceTabContext): RepoRef | null {
    const stored = context.storage.get("connection");
    return isRepo(stored) ? stored : null;
  }

  /** Cheap, as Mirador asks at every switch to the workspace: a git repository, or one the user connected by hand. */
  shows(context: WorkspaceTabContext) {
    return this.connectionOf(context) !== null || existsSync(join(context.workspace.folder, ".git"));
  }

  async state(context: WorkspaceTabContext): Promise<TabState> {
    const cache = this.cacheOf(context);
    const connection = this.connectionOf(context);
    if (!connection && cache.candidates === null) cache.candidates = await this.remotesOf(context.workspace.folder);
    return {
      connection,
      candidates: cache.candidates ?? [],
      problem: cache.problem,
      branch: cache.branch,
      branchPr: cache.branchPr,
      meta: cache.meta,
      lists: Object.fromEntries(cache.lists),
      counts: cache.counts,
      details: Object.fromEntries(cache.details),
      savedViews: savedViewsOf(context.storage.get("savedViews")),
      prefs: prefsOf(context.storage.get("prefs")),
      loading: [...cache.loading],
    };
  }

  async action(action: unknown, context: WorkspaceTabContext): Promise<unknown> {
    const asked = action as TabAction;
    switch (asked.kind) {
      case "connect":
        return this.connect(asked.repo, context);
      case "disconnect":
        context.storage.set("connection", undefined);
        this.caches.set(context.workspace.id, emptyCache());
        context.changed();
        return null;
      case "refresh":
        await this.refresh(context, asked.list, asked.counts);
        return null;
      case "open":
        await this.fetchDetail(context, asked.item, asked.number);
        return null;
      case "prefs":
        context.storage.set("prefs", prefsOf(asked.prefs));
        context.changed();
        return null;
      case "save-view":
        return this.saveView(context, asked.item, asked.name, asked.query);
      case "remove-view": {
        const views = savedViewsOf(context.storage.get("savedViews"));
        context.storage.set("savedViews", { ...views, [asked.item]: views[asked.item].filter(({ name }) => name !== asked.name) });
        context.changed();
        return null;
      }
      case "checkout":
        return this.checkout(context, asked.number, asked.evenIfChanged);
      case "comment":
      case "set-state":
      case "merge":
      case "review":
      case "labels":
      case "assignees":
      case "ready":
      case "create-issue":
        return this.write(context, asked);
      default:
        throw new Error(`The GitHub tab doesn't know the action ${JSON.stringify((asked as { kind?: unknown }).kind)}.`);
    }
  }

  private async remotesOf(folder: string) {
    try {
      const ran = await this.run("git", ["remote", "-v"], { cwd: folder });
      return ran.code === 0 ? remoteCandidates(ran.stdout) : [];
    } catch {
      return [];
    }
  }

  /** Runs gh in the workspace; what it can't do is a GhFailed, and one that blocks every call is the tab's problem until a call works. */
  private async gh(context: WorkspaceTabContext, repo: RepoRef, args: string[]): Promise<string> {
    const cache = this.cacheOf(context);
    let ran: Ran;
    try {
      ran = await this.run("gh", args, { cwd: context.workspace.folder });
    } catch (error) {
      if (!(error instanceof ProgramMissing)) throw error;
      cache.problem = problemOf(error, repo.host);
      throw new GhFailed(cache.problem);
    }
    if (ran.code !== 0) {
      const problem = problemOf(ran, repo.host);
      if (BLOCKING.includes(problem.code)) cache.problem = problem;
      throw new GhFailed(problem);
    }
    cache.problem = null;
    return ran.stdout;
  }

  private async ghJson<Shape>(context: WorkspaceTabContext, repo: RepoRef, args: string[]): Promise<Shape> {
    return JSON.parse(await this.gh(context, repo, args)) as Shape;
  }

  /** One fetch per key at a time; asking again while it runs waits for the same one. The key shows as loading meanwhile. */
  private once<Result>(context: WorkspaceTabContext, key: string, fetch: () => Promise<Result>): Promise<Result> {
    const cache = this.cacheOf(context);
    const running = cache.fetching.get(key);
    if (running) return running as Promise<Result>;
    cache.loading.add(key);
    context.changed();
    const fetching = fetch().finally(() => {
      cache.fetching.delete(key);
      cache.loading.delete(key);
      context.changed();
    });
    cache.fetching.set(key, fetching);
    return fetching;
  }

  private connected(context: WorkspaceTabContext) {
    const repo = this.connectionOf(context);
    if (!repo) throw new Error("Connect the workspace to a GitHub repository first.");
    return repo;
  }

  private async connect(text: string, context: WorkspaceTabContext) {
    const repo = parseRepo(text);
    if (!repo) throw new Error(`"${text}" isn't a GitHub repository: write it as owner/name, host/owner/name, or its URL.`);
    const cache = emptyCache();
    this.caches.set(context.workspace.id, cache);
    try {
      cache.meta = await this.fetchMeta(context, repo);
    } catch (error) {
      if (error instanceof GhFailed && error.problem.code !== "not-found") throw error;
      throw new Error(`gh can't see ${repo.owner}/${repo.name} on ${repo.host}: check its name, and that your account can reach it.`);
    }
    context.storage.set("connection", repo);
    context.changed();
    return { connected: repo };
  }

  private async fetchMeta(context: WorkspaceTabContext, repo: RepoRef): Promise<RepoMeta> {
    const [about, labels, viewer] = await Promise.all([
      this.ghJson<Record<string, unknown>>(context, repo, repoMetaArgs(repo)),
      this.ghJson<{ name: string; color: string }[]>(context, repo, labelsArgs(repo)).catch(() => []),
      this.gh(context, repo, viewerArgs(repo)).then((login) => login.trim() || null, () => null),
    ]);
    const permission = String(about.viewerPermission ?? "");
    return {
      viewer,
      labels: labels.map(({ name, color }) => ({ name, color })),
      assignable: (Array.isArray(about.assignableUsers) ? about.assignableUsers : []).map((user) => String((user as { login?: unknown }).login ?? "")).filter(Boolean),
      mergeMethods: mergeMethodsOf(about),
      deleteBranchOnMerge: about.deleteBranchOnMerge === true,
      defaultBranch: String((about.defaultBranchRef as { name?: unknown } | null)?.name ?? "") || null,
      canPush: ["ADMIN", "MAINTAIN", "WRITE"].includes(permission),
    };
  }

  /** Whatever of a list, the views' counts, the branch and the repository's labels and people the tab needs now. */
  private async refresh(context: WorkspaceTabContext, list: { kind: ItemKind; query: string } | null, counts: ItemKind | null) {
    const repo = this.connected(context);
    const cache = this.cacheOf(context);
    await Promise.allSettled([
      list && this.fetchList(context, repo, list.kind, list.query),
      counts && this.fetchCounts(context, repo, counts),
      this.fetchBranch(context, repo),
      !cache.meta && this.once(context, "meta", async () => (cache.meta = await this.fetchMeta(context, repo))),
    ]);
  }

  private fetchList(context: WorkspaceTabContext, repo: RepoRef, kind: ItemKind, query: string) {
    const key = listKey(kind, query);
    const cache = this.cacheOf(context);
    return this.once(context, key, async () => {
      const previous = cache.lists.get(key);
      try {
        const rows = await this.ghJson<Record<string, unknown>[]>(context, repo, listArgs(repo, kind, query));
        keepNewest(cache.lists, key, { items: rows.map(kind === "pr" ? prItem : issueItem), fetchedAt: Date.now(), problem: null }, KEPT_LISTS);
      } catch (error) {
        if (!(error instanceof GhFailed)) throw error;
        keepNewest(cache.lists, key, { items: previous?.items ?? [], fetchedAt: previous?.fetchedAt ?? null, problem: error.problem }, KEPT_LISTS);
      }
    });
  }

  private fetchCounts(context: WorkspaceTabContext, repo: RepoRef, kind: ItemKind) {
    const queries = [...BUILT_IN_VIEWS[kind], ...savedViewsOf(context.storage.get("savedViews"))[kind]].map(({ query }) => query);
    const cache = this.cacheOf(context);
    return this.once(context, `counts:${kind}`, async () => {
      const answer = await this.ghJson<{ data?: Record<string, { issueCount?: number }> }>(context, repo, countsArgs(repo, kind, queries)).catch(() => null);
      if (!answer?.data) return;
      queries.forEach((query, index) => {
        const found = answer.data![`q${index}`]?.issueCount;
        if (typeof found === "number") cache.counts[listKey(kind, query)] = found;
      });
    });
  }

  private fetchBranch(context: WorkspaceTabContext, repo: RepoRef) {
    const cache = this.cacheOf(context);
    return this.once(context, "branch", async () => {
      const ran = await this.run("git", ["branch", "--show-current"], { cwd: context.workspace.folder }).catch(() => null);
      const branch = ran?.code === 0 ? ran.stdout.trim() || null : null;
      cache.branch = branch;
      if (!branch || branch === cache.meta?.defaultBranch) {
        cache.branchPr = null;
        return;
      }
      const pr = await this.ghJson<Record<string, unknown>>(context, repo, branchPrArgs(repo, branch)).catch(() => null);
      cache.branchPr = pr ? prItem(pr) : null;
    });
  }

  private fetchDetail(context: WorkspaceTabContext, kind: ItemKind, number: number) {
    const repo = this.connected(context);
    const key = detailKey(kind, number);
    const cache = this.cacheOf(context);
    return this.once(context, key, async () => {
      const previous = cache.details.get(key);
      try {
        const json = await this.ghJson<Record<string, unknown>>(context, repo, viewArgs(repo, kind, number));
        keepNewest(cache.details, key, { detail: kind === "pr" ? prDetail(json) : issueDetail(json), fetchedAt: Date.now(), problem: null }, KEPT_DETAILS);
      } catch (error) {
        if (!(error instanceof GhFailed)) throw error;
        keepNewest(cache.details, key, { detail: previous?.detail ?? null, fetchedAt: previous?.fetchedAt ?? null, problem: error.problem }, KEPT_DETAILS);
      }
    });
  }

  private saveView(context: WorkspaceTabContext, kind: ItemKind, name: string, query: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the view a name.");
    if (BUILT_IN_VIEWS[kind].some((view) => view.name.toLowerCase() === trimmed.toLowerCase())) throw new Error(`"${trimmed}" is one of the built-in views; pick another name.`);
    const views = savedViewsOf(context.storage.get("savedViews"));
    const others = views[kind].filter((view) => view.name.toLowerCase() !== trimmed.toLowerCase());
    context.storage.set("savedViews", { ...views, [kind]: [...others, { name: trimmed, query: query.trim() }] });
    context.changed();
    return { saved: trimmed };
  }

  /** After a write: the item as GitHub has it now, and the lists and counts of its kind, which it may have moved in or out of. */
  private async refreshAfterWrite(context: WorkspaceTabContext, kind: ItemKind, number: number | null) {
    const repo = this.connected(context);
    const prefs = prefsOf(context.storage.get("prefs"));
    await Promise.allSettled([
      number !== null && this.fetchDetail(context, kind, number),
      this.fetchList(context, repo, kind, prefs.query[kind]),
      this.fetchCounts(context, repo, kind),
      kind === "pr" && this.fetchBranch(context, repo),
    ]);
  }

  private async write(context: WorkspaceTabContext, action: Parameters<typeof writeArgs>[1]) {
    const repo = this.connected(context);
    let output: string;
    try {
      output = await this.gh(context, repo, writeArgs(repo, action));
    } catch (error) {
      if (error instanceof GhFailed) throw new Error(error.problem.message);
      throw error;
    }
    const kind: ItemKind = "item" in action ? action.item : action.kind === "create-issue" ? "issue" : "pr";
    const created = action.kind === "create-issue" ? Number(/\/issues\/(\d+)/.exec(output)?.[1]) || null : null;
    const number = "number" in action ? action.number : created;
    void this.refreshAfterWrite(context, kind, number);
    return { done: true, ...(created !== null && { number: created }) };
  }

  private async checkout(context: WorkspaceTabContext, number: number, evenIfChanged: boolean): Promise<CheckoutReply> {
    const repo = this.connected(context);
    const status = await this.run("git", ["status", "--porcelain"], { cwd: context.workspace.folder });
    const changedFiles = status.stdout
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    if (changedFiles.length > 0 && !evenIfChanged) return { checkedOut: false, changedFiles };
    try {
      await this.gh(context, repo, checkoutArgs(repo, number));
    } catch (error) {
      if (error instanceof GhFailed) throw new Error(error.problem.message);
      throw error;
    }
    await this.fetchBranch(context, repo);
    return { checkedOut: true, branch: this.cacheOf(context).branch };
  }
}
