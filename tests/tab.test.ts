import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceTabContext } from "../mirador/api.ts";
import { detailKey, listKey, type CheckoutReply, type TabState } from "../github/model.ts";
import { PROMPTS } from "../github/prompts.ts";
import { GitHubTab } from "../github/tab.ts";
import type { Runner } from "../github/run.ts";
import { FakeGitHub } from "./fake-gh.ts";

interface Git {
  remotes: string;
  branch: string;
  changes: string;
}

function setUp(git: Partial<Git> = {}) {
  const github = new FakeGitHub();
  const repoGit: Git = { remotes: "origin\tgit@github.com:acme/widgets.git (fetch)\n", branch: "drag-queue", changes: "", ...git };
  const calls: string[] = [];
  const run: Runner = async (program, args) => {
    calls.push(`${program} ${args.join(" ")}`);
    if (program === "gh") return github.answer(args);
    if (args[0] === "remote") return { code: 0, stdout: repoGit.remotes, stderr: "" };
    if (args[0] === "branch") return { code: 0, stdout: `${repoGit.branch}\n`, stderr: "" };
    if (args[0] === "status") return { code: 0, stdout: repoGit.changes, stderr: "" };
    return { code: 1, stdout: "", stderr: "unknown git command" };
  };
  const folder = mkdtempSync(join(tmpdir(), "mirador-github-"));
  mkdirSync(join(folder, ".git"));
  const stored = new Map<string, unknown>();
  const shared = new Map<string, unknown>();
  let changes = 0;
  const context: WorkspaceTabContext = {
    workspace: { id: "w1", name: "widgets", folder },
    storage: { get: (key) => stored.get(key), set: (key, value) => void (value === undefined ? stored.delete(key) : stored.set(key, value)) },
    sharedStorage: { get: (key) => shared.get(key), set: (key, value) => void (value === undefined ? shared.delete(key) : shared.set(key, value)) },
    changed: () => void changes++,
  };
  const tab = new GitHubTab(run);
  const state = () => tab.state(context) as Promise<TabState>;
  const act = (action: unknown) => tab.action(action, context);
  return { github, repoGit, calls, context, tab, state, act, changes: () => changes };
}

describe("connecting a workspace", () => {
  test("offers the git remotes that point at GitHub, and shows only in a git repository", async () => {
    const { state, tab, context } = setUp();
    expect((await state()).candidates).toEqual([{ remote: "origin", repo: { host: "github.com", owner: "acme", name: "widgets" } }]);
    expect(tab.shows(context)).toBe(true);
    expect(tab.shows({ ...context, workspace: { ...context.workspace, folder: tmpdir() } })).toBe(false);
  });

  test("checks gh can see the repository, then keeps it with its labels, people and merge methods", async () => {
    const { state, act } = setUp();
    expect(await act({ kind: "connect", repo: "acme/widgets" })).toEqual({ connected: { host: "github.com", owner: "acme", name: "widgets" } });
    const connected = await state();
    expect(connected.connection).toEqual({ host: "github.com", owner: "acme", name: "widgets" });
    expect(connected.meta).toMatchObject({ viewer: "sodre90", mergeMethods: ["squash", "merge"], assignable: ["lena-ortiz", "tom-baker", "sodre90"], canPush: true });
    expect(connected.meta?.labels.map(({ name }) => name)).toEqual(["bug", "enhancement", "good first issue"]);
  });

  test("refuses a repository gh can't see, and words it can't read", async () => {
    const { act } = setUp();
    expect(act({ kind: "connect", repo: "acme/nothing" })).rejects.toThrow("gh can't see acme/nothing on github.com");
    expect(act({ kind: "connect", repo: "what?" })).rejects.toThrow("isn't a GitHub repository");
  });

  test("gh not signed in is the whole tab's problem, until gh answers again", async () => {
    const { state, act, github } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    github.signedIn = false;
    await act({ kind: "refresh", list: { kind: "pr", query: "is:open" }, counts: null });
    expect((await state()).problem).toMatchObject({ code: "not-signed-in", host: "github.com" });
    github.signedIn = true;
    await act({ kind: "refresh", list: { kind: "pr", query: "is:open" }, counts: null });
    expect((await state()).problem).toBeNull();
  });
});

describe("refreshing", () => {
  test("fetches the list, every view's count, and the PR of the branch checked out", async () => {
    const { state, act } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    await act({ kind: "refresh", list: { kind: "pr", query: "is:open review-requested:@me" }, counts: "pr" });
    const refreshed = await state();
    expect(refreshed.lists[listKey("pr", "is:open review-requested:@me")]?.items.map(({ number }) => number)).toEqual([405]);
    expect(refreshed.counts).toMatchObject({ [listKey("pr", "is:open")]: 3, [listKey("pr", "is:open author:@me")]: 1, [listKey("pr", "is:open status:failure")]: 1 });
    expect(refreshed).toMatchObject({ branch: "drag-queue", branchPr: { number: 412 } });
    expect(refreshed.loading).toEqual([]);
  });

  test("asking for the same list while it loads waits for the one fetch", async () => {
    const { act, calls } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    await Promise.all([1, 2, 3].map(() => act({ kind: "refresh", list: { kind: "issue", query: "is:open" }, counts: null })));
    expect(calls.filter((call) => call.startsWith("gh issue list"))).toHaveLength(1);
  });

  test("a list that fails keeps what it showed, with the problem", async () => {
    const { state, act, github } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    await act({ kind: "refresh", list: { kind: "issue", query: "is:open" }, counts: null });
    github.answer = () => ({ code: 1, stdout: "", stderr: "API rate limit exceeded" });
    await act({ kind: "refresh", list: { kind: "issue", query: "is:open" }, counts: null });
    expect((await state()).lists[listKey("issue", "is:open")]).toMatchObject({ items: [{ number: 60 }, { number: 25 }], problem: { code: "rate-limited" } });
  });

  test("on the default branch there's no branch PR to pin", async () => {
    const { state, act } = setUp({ branch: "main" });
    await act({ kind: "connect", repo: "acme/widgets" });
    await act({ kind: "refresh", list: null, counts: null });
    expect(await state()).toMatchObject({ branch: "main", branchPr: null });
  });
});

describe("the user's actions", () => {
  test("opening an item fetches its details", async () => {
    const { state, act } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    await act({ kind: "open", item: "pr", number: 405 });
    expect((await state()).details[detailKey("pr", 405)]?.detail).toMatchObject({ title: "Fix canvas resize on narrow panes", checkList: [{ state: "failed" }, { state: "passed" }] });
  });

  test("a comment posts, then the item comes back with it", async () => {
    const { state, act } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    expect(await act({ kind: "comment", item: "issue", number: 60, body: "On it", close: false })).toEqual({ done: true });
    await Bun.sleep(10);
    expect((await state()).details[detailKey("issue", 60)]?.detail?.timeline.at(-1)).toMatchObject({ author: "sodre90", body: "On it" });
  });

  test("a new issue answers with its number", async () => {
    const { act } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    expect(await act({ kind: "create-issue", title: "Crash on start", body: "Steps…" })).toEqual({ done: true, number: 61 });
  });

  test("a write gh refuses says why", async () => {
    const { act } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    expect(act({ kind: "merge", number: 999, method: "squash", deleteBranch: false })).rejects.toThrow("Could not resolve to a PullRequest");
  });

  test("checking out stops at uncommitted changes, unless the user goes on anyway", async () => {
    const { act, github, repoGit } = setUp({ changes: " M web/App.tsx\n?? notes.md\n" });
    await act({ kind: "connect", repo: "acme/widgets" });
    expect((await act({ kind: "checkout", number: 405, evenIfChanged: false })) as CheckoutReply).toEqual({ checkedOut: false, changedFiles: ["web/App.tsx", "notes.md"] });
    expect(github.checkedOut).toBeNull();
    repoGit.branch = "fix-resize";
    expect(await act({ kind: "checkout", number: 405, evenIfChanged: true })).toEqual({ checkedOut: true, branch: "fix-resize" });
    expect(github.checkedOut).toBe(405);
  });

  test("views the user saves are kept for the workspace and counted with the built-in ones", async () => {
    const { state, act } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    await act({ kind: "save-view", item: "issue", name: "Bugs", query: "is:open label:bug" });
    expect(act({ kind: "save-view", item: "issue", name: "mine", query: "x" })).rejects.toThrow("built-in");
    await act({ kind: "refresh", list: null, counts: "issue" });
    const saved = await state();
    expect(saved.savedViews.issue).toEqual([{ name: "Bugs", query: "is:open label:bug" }]);
    expect(saved.counts[listKey("issue", "is:open label:bug")]).toBe(1);
    await act({ kind: "remove-view", item: "issue", name: "Bugs" });
    expect((await state()).savedViews.issue).toEqual([]);
  });

  test("disconnecting forgets the repository and what was fetched from it", async () => {
    const { state, act } = setUp();
    await act({ kind: "connect", repo: "acme/widgets" });
    await act({ kind: "refresh", list: { kind: "pr", query: "is:open" }, counts: null });
    await act({ kind: "disconnect" });
    expect(await state()).toMatchObject({ connection: null, lists: {}, meta: null });
  });
});

describe("the messages the tab sends", () => {
  test("keep only the user's own text, for this workspace or every workspace, and put back takes it out", async () => {
    const { state, act } = setUp();
    await act({ kind: "set-prompt", scope: "every", prompt: "review", text: "Review {ref} for security." });
    await act({ kind: "set-prompt", scope: "workspace", prompt: "review", text: "Review {ref} the way this team does." });
    expect((await state()).prompts).toEqual({ workspace: { review: "Review {ref} the way this team does." }, every: { review: "Review {ref} for security." } });
    await act({ kind: "set-prompt", scope: "workspace", prompt: "review", text: "Review {ref} for security." });
    expect((await state()).prompts.workspace).toEqual({});
    await act({ kind: "set-prompt", scope: "every", prompt: "review", text: null });
    await act({ kind: "set-prompt", scope: "every", prompt: "work-pr", text: PROMPTS["work-pr"].builtIn });
    expect((await state()).prompts).toEqual({ workspace: {}, every: {} });
    await expect(act({ kind: "set-prompt", scope: "every", prompt: "nonsense", text: "x" })).rejects.toThrow("no message");
  });
});
