import { describe, expect, test } from "bun:test";
import { ago, agoText, labelInk, updatedText } from "../github/format.ts";
import { fixCheckText, mentionText, workText } from "../github/handoff.ts";
import { countsArgs, listArgs, problemOf, shellText, writeArgs } from "../github/gh.ts";
import { checkStateOf, issueDetail, issueItem, prDetail, prItem } from "../github/normalize.ts";
import { freeText, isValue, sameQuery, valuesOf, withIs, withValues } from "../github/query.ts";
import { parseRepo, remoteCandidates, repoArg } from "../github/remote.ts";
import { ProgramMissing } from "../github/run.ts";
import { ISSUES, PRS } from "./fixtures/github.ts";

describe("a repository", () => {
  test("is read from every way a remote names one", () => {
    const widgets = { host: "github.com", owner: "acme", name: "widgets" };
    for (const url of ["git@github.com:acme/widgets.git", "https://github.com/acme/widgets", "https://github.com/acme/widgets.git", "ssh://git@github.com/acme/widgets.git", "acme/widgets", "github.com/acme/widgets"]) {
      expect(parseRepo(url)).toEqual(widgets);
    }
    expect(parseRepo("git@github.example.com:team/app.git")).toEqual({ host: "github.example.com", owner: "team", name: "app" });
    expect(parseRepo("https://user@github.example.com:8443/team/app")).toEqual({ host: "github.example.com", owner: "team", name: "app" });
    expect(parseRepo("not a repo")).toBeNull();
  });

  test("gh names one on github.com without its host, and one elsewhere with it", () => {
    expect(repoArg({ host: "github.com", owner: "acme", name: "widgets" })).toBe("acme/widgets");
    expect(repoArg({ host: "github.example.com", owner: "team", name: "app" })).toBe("github.example.com/team/app");
  });

  test("the workspace's remotes are offered once each, origin and upstream first", () => {
    const remotes = remoteCandidates(
      ["fork\tgit@github.com:me/widgets.git (fetch)", "fork\tgit@github.com:me/widgets.git (push)", "upstream\thttps://github.com/acme/widgets (fetch)", "origin\tgit@github.com:sodre90/widgets.git (fetch)", "local\t/tmp/x (fetch)"].join("\n"),
    );
    expect(remotes.map(({ remote }) => remote)).toEqual(["origin", "upstream", "fork"]);
  });
});

describe("gh's answers", () => {
  test("a PR row has its state, checks, review and branch", () => {
    const [approved, changesAsked, draft] = PRS.map((pr) => prItem(pr));
    expect(approved).toMatchObject({ number: 412, state: "open", checks: { passed: 2, failed: 0, pending: 0, total: 2 }, review: "approved", comments: 1, headRef: "drag-queue" });
    expect(changesAsked).toMatchObject({ checks: { failed: 1, total: 2 }, review: "changes-requested", reviewRequested: ["sodre90"], labels: [{ name: "bug", color: "d73a4a" }] });
    expect(draft).toMatchObject({ state: "draft", checks: { pending: 1 } });
  });

  test("a check's mark comes from its run or its status", () => {
    expect(checkStateOf({ status: "COMPLETED", conclusion: "NEUTRAL" })).toBe("passed");
    expect(checkStateOf({ status: "COMPLETED", conclusion: "TIMED_OUT" })).toBe("failed");
    expect(checkStateOf({ status: "COMPLETED", conclusion: "SKIPPED" })).toBe("skipped");
    expect(checkStateOf({ status: "QUEUED", conclusion: "" })).toBe("pending");
    expect(checkStateOf({ __typename: "StatusContext", state: "ERROR" })).toBe("failed");
    expect(checkStateOf({ __typename: "StatusContext", state: "SUCCESS" })).toBe("passed");
  });

  test("a PR's details put its comments and its reviews that say or decide something in the order they came", () => {
    const detail = prDetail({ ...PRS[0]!, reviews: [...PRS[0]!.reviews, { author: { login: "x" }, state: "COMMENTED", body: "", submittedAt: "2026-11-03T11:00:00Z" }] });
    expect(detail.timeline.map(({ kind, author, verdict }) => [kind, author, verdict])).toEqual([
      ["review", "sodre90", "approved"],
      ["comment", "sodre90", undefined],
    ]);
    expect(detail).toMatchObject({ commits: 3, mergeable: "mergeable", closesIssues: [60], files: [{ path: "web/Queue.tsx", additions: 100, deletions: 30 }, expect.anything()] });
  });

  test("an issue has its sub-issues, the PRs that close it, and why it closed", () => {
    expect(issueItem(ISSUES[0]!)).toMatchObject({ subIssues: { done: 2, total: 5 }, linkedPrs: [412], assignees: ["sodre90"] });
    expect(issueItem({ ...ISSUES[0]!, state: "CLOSED", stateReason: "NOT_PLANNED" })).toMatchObject({ state: "closed", stateReason: "not planned" });
    expect(issueDetail(ISSUES[0]!).subIssueList).toEqual([{ number: 61, title: "Tiles", state: "closed" }]);
  });

  test("problems are told apart from gh's words", () => {
    const failed = (stderr: string) => problemOf({ code: 1, stdout: "", stderr }, "github.example.com");
    expect(problemOf(new ProgramMissing("gh"), "github.com").code).toBe("not-installed");
    expect(failed("To get started with GitHub CLI, please run:  gh auth login")).toMatchObject({ code: "not-signed-in", host: "github.example.com" });
    expect(failed("GraphQL: Could not resolve to a Repository with the name 'a/b'.").code).toBe("not-found");
    expect(failed("API rate limit exceeded for user").code).toBe("rate-limited");
    expect(failed("error connecting to api.github.com: dial tcp: lookup api.github.com: no such host").code).toBe("offline");
    expect(failed("\n  something else broke\nmore")).toEqual({ code: "failed", message: "something else broke" });
  });
});

describe("gh commands", () => {
  const repo = { host: "github.com", owner: "acme", name: "widgets" };

  test("a list asks for every state, so the query alone says which", () => {
    expect(listArgs(repo, "pr", " is:open label:bug ")).toEqual(expect.arrayContaining(["pr", "list", "-R", "acme/widgets", "--state", "all", "--search", "is:open label:bug"]));
    expect(listArgs(repo, "issue", "")).not.toContain("--search");
  });

  test("every view's count comes from one GraphQL call, on the repository's server", () => {
    const args = countsArgs({ host: "github.example.com", owner: "team", name: "app" }, "pr", ["is:open", 'label:"good first"']);
    expect(args.slice(0, 4)).toEqual(["api", "graphql", "--hostname", "github.example.com"]);
    expect(args[5]).toContain('q0: search(type: ISSUE, query: "repo:team/app is:pr is:open")');
    expect(args[5]).toContain('q1: search(type: ISSUE, query: "repo:team/app is:pr label:\\"good first\\"")');
  });

  test("writes run the commands the user confirms", () => {
    expect(writeArgs(repo, { kind: "merge", number: 405, method: "squash", deleteBranch: true })).toEqual(["pr", "merge", "405", "-R", "acme/widgets", "--squash", "--delete-branch"]);
    expect(writeArgs(repo, { kind: "set-state", item: "issue", number: 25, open: false, reason: "not planned" })).toEqual(["issue", "close", "25", "-R", "acme/widgets", "--reason", "not planned"]);
    expect(writeArgs(repo, { kind: "review", number: 405, verdict: "request-changes", body: "Fix it" })).toEqual(["pr", "review", "405", "-R", "acme/widgets", "--request-changes", "--body", "Fix it"]);
    expect(writeArgs(repo, { kind: "labels", item: "pr", number: 1, add: ["bug"], remove: ["wip"] })).toEqual(["pr", "edit", "1", "-R", "acme/widgets", "--add-label", "bug", "--remove-label", "wip"]);
    expect(writeArgs(repo, { kind: "comment", item: "issue", number: 25, body: "Done", close: true })).toEqual(["issue", "close", "25", "-R", "acme/widgets", "--comment", "Done", "--reason", "completed"]);
    expect(writeArgs(repo, { kind: "comment", item: "pr", number: 405, body: "Superseded", close: true })).toEqual(["pr", "close", "405", "-R", "acme/widgets", "--comment", "Superseded"]);
    expect(writeArgs(repo, { kind: "ready", number: 409, ready: false })).toEqual(["pr", "ready", "409", "-R", "acme/widgets", "--undo"]);
    expect(shellText(["pr", "comment", "1", "--body", "It's done"])).toBe("gh pr comment 1 --body 'It'\\''s done'");
  });
});

describe("a query", () => {
  test("chips set their qualifiers and leave the rest as it was", () => {
    expect(withValues("is:open fix label:bug", "label", ["bug", "good first issue"])).toBe('is:open fix label:bug label:"good first issue"');
    expect(valuesOf('is:open label:bug label:"good first issue"', "label")).toEqual(["bug", "good first issue"]);
    expect(withValues("is:open author:me crash", "author", [])).toBe("is:open crash");
  });

  test("the state chip changes only the is: values it owns", () => {
    expect(withIs("is:open is:draft", ["open", "closed", "merged"], "merged")).toBe("is:draft is:merged");
    expect(isValue("is:draft is:CLOSED", ["open", "closed"])).toBe("closed");
    expect(withIs("is:open crash", ["open", "closed"], null)).toBe("crash");
  });

  test("free text is what isn't a qualifier, and order doesn't make queries differ", () => {
    expect(freeText('is:open drag "queue order" label:bug')).toBe('drag "queue order"');
    expect(sameQuery("is:open  author:@me", "author:@me is:open")).toBe(true);
  });
});

describe("the view's words", () => {
  test("say when in a sentence", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    expect(agoText("2026-11-03T11:59:50Z", now)).toBe("just now");
    expect(agoText("2026-11-03T09:00:00Z", now)).toBe("3h ago");
    expect(agoText("2026-08-01T09:00:00Z", now)).toStartWith("on ");
    expect(agoText(null, now)).toBe("");
  });

  const repo = { host: "github.com", owner: "acme", name: "widgets" };

  test("times read as a list row needs them", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    expect(["2026-11-03T11:59:40Z", "2026-11-03T11:50:00Z", "2026-11-03T09:00:00Z", "2026-11-01T12:00:00Z", "2026-10-13T12:00:00Z"].map((at) => ago(at, now))).toEqual(["now", "10m", "3h", "2d", "3w"]);
    expect(updatedText(now - 125_000, now)).toBe("Updated 2 min ago");
    expect(labelInk("ffffff")).toBe("#1f2328");
    expect(labelInk("0e1a6b")).toBe("#ffffff");
  });

  test("the agent hears what an item is, where, how it stands, and how to read more", () => {
    const pr = prDetail(PRS[1]!);
    const text = workText(repo, pr, pr);
    expect(text).toStartWith('Work on pull request acme/widgets#405: "Fix canvas resize on narrow panes" (fix-resize → main)');
    expect(text).toContain("Checks: 1 failing (e2e (ubuntu)). Review: changes requested.");
    expect(text).toContain("gh pr view 405 -R acme/widgets --comments");
    expect(workText(repo, issueItem(ISSUES[1]!), null)).toBe(
      'Work on GitHub issue acme/widgets#25: "Fork title gets (fork) at each rewind"\n\nhttps://github.com/acme/widgets/issues/25\n\nRead its comments with `gh issue view 25 -R acme/widgets --comments`. Don\'t post to GitHub unless I ask.',
    );
    expect(mentionText(repo, pr)).toBe('acme/widgets#405 ("Fix canvas resize on narrow panes")');
    expect(fixCheckText(repo, pr, pr.checkList![0]!)).toContain('The check "e2e (ubuntu)" fails on pull request acme/widgets#405');
  });
});
