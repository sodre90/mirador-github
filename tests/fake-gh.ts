import { ISSUES, LABELS, PRS, REPO, VIEWER } from "./fixtures/github.ts";

/**
 * Answers gh's commands about acme/widgets from the fixtures, as gh would, and keeps what the writes change, so a test
 * sees a comment it posted or a PR it merged. Searches understand is:, author:, assignee:, label: and
 * review-requested:, enough for the views.
 */
export class FakeGitHub {
  prs = structuredClone(PRS) as Record<string, unknown>[];
  issues = structuredClone(ISSUES) as Record<string, unknown>[];
  signedIn = true;
  checkedOut: number | null = null;

  answer(args: string[]): { code: number; stdout: string; stderr: string } {
    if (!this.signedIn) return { code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" };
    const [group, command] = args;
    const flag = (name: string) => {
      const at = args.indexOf(name);
      return at >= 0 ? args[at + 1] : undefined;
    };
    const ok = (value: unknown) => ({ code: 0, stdout: typeof value === "string" ? value : JSON.stringify(value), stderr: "" });
    const repo = flag("-R") ?? (group === "repo" && command === "view" ? args[2] : undefined);
    if (repo !== undefined && repo !== "acme/widgets") return { code: 1, stdout: "", stderr: `GraphQL: Could not resolve to a Repository with the name '${repo}'. (repository)` };
    const items = (kind: string) => (kind === "pr" ? this.prs : this.issues);
    const find = (kind: string, number: string | undefined) => items(kind).find((item) => String(item.number) === number || item.headRefName === number);
    const missing = (kind: string, number: string | undefined) => ({ code: 1, stdout: "", stderr: `GraphQL: Could not resolve to a ${kind === "pr" ? "PullRequest" : "Issue"} with the number of ${number}.` });

    if (group === "api" && command === "user") return ok(`${VIEWER}\n`);
    if (group === "api" && command === "graphql") {
      const query = flag("-f") ?? "";
      const data = Object.fromEntries(
        [...query.matchAll(/(q\d+): search\(type: ISSUE, query: ("(?:[^"\\]|\\.)*")\)/g)].map(([, alias, search]) => {
          const text = JSON.parse(search!) as string;
          const kind = text.includes("is:pr") ? "pr" : "issue";
          return [alias, { issueCount: this.search(items(kind), text).length }];
        }),
      );
      return ok({ data });
    }
    if (group === "repo" && command === "view") return ok(REPO);
    if (group === "label" && command === "list") return ok(LABELS);
    if ((group === "pr" || group === "issue") && command === "list") return ok(this.search(items(group), flag("--search") ?? ""));
    if ((group === "pr" || group === "issue") && command === "view") {
      const item = find(group, args[2]);
      return item ? ok(item) : group === "pr" && !/^\d+$/.test(args[2] ?? "") ? { code: 1, stdout: "", stderr: `no pull requests found for branch "${args[2]}"` } : missing(group, args[2]);
    }
    const item = find(group!, args[2]);
    if (!item && command !== "create") return missing(group!, args[2]);
    switch (`${group} ${command}`) {
      case "pr comment":
      case "issue comment":
        (item!.comments as unknown[]).push({ author: { login: VIEWER }, body: flag("--body"), createdAt: new Date().toISOString(), url: `${item!.url}#new` });
        return ok(`${item!.url}#new\n`);
      case "pr close":
      case "issue close":
        item!.state = "CLOSED";
        if (flag("--comment")) (item!.comments as unknown[]).push({ author: { login: VIEWER }, body: flag("--comment"), createdAt: new Date().toISOString(), url: `${item!.url}#new` });
        if (flag("--reason")) item!.stateReason = flag("--reason")!.toUpperCase().replace(" ", "_");
        return ok("");
      case "pr reopen":
      case "issue reopen":
        item!.state = "OPEN";
        return ok("");
      case "pr merge":
        item!.state = "MERGED";
        return ok("");
      case "pr review": {
        const state = args.includes("--approve") ? "APPROVED" : args.includes("--request-changes") ? "CHANGES_REQUESTED" : "COMMENTED";
        (item!.reviews as unknown[]).push({ author: { login: VIEWER }, state, body: flag("--body") ?? "", submittedAt: new Date().toISOString() });
        if (state !== "COMMENTED") item!.reviewDecision = state;
        return ok("");
      }
      case "pr ready":
        item!.isDraft = args.includes("--undo");
        return ok("");
      case "pr edit":
      case "issue edit": {
        const added = (name: string) => args.flatMap((arg, index) => (arg === name ? [args[index + 1]!] : []));
        const labels = (item!.labels as { name: string; color: string }[]).filter(({ name }) => !added("--remove-label").includes(name));
        item!.labels = [...labels, ...added("--add-label").map((name) => LABELS.find((label) => label.name === name) ?? { name, color: "888888" })];
        const assignees = (item!.assignees as { login: string }[]).filter(({ login }) => !added("--remove-assignee").includes(login));
        item!.assignees = [...assignees, ...added("--add-assignee").map((login) => ({ login }))];
        return ok(`${item!.url}\n`);
      }
      case "pr checkout":
        this.checkedOut = Number(args[2]);
        return ok("");
      case "issue create": {
        const number = Math.max(...this.issues.map((issue) => Number(issue.number))) + 1;
        this.issues.unshift({
          ...structuredClone(ISSUES[1]),
          number,
          title: flag("--title"),
          body: flag("--body"),
          author: { login: VIEWER },
          labels: [],
          url: `https://github.com/acme/widgets/issues/${number}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return ok(`https://github.com/acme/widgets/issues/${number}\n`);
      }
    }
    return { code: 1, stdout: "", stderr: `The fake gh doesn't know: gh ${args.join(" ")}` };
  }

  private search(items: Record<string, unknown>[], query: string) {
    const terms = query.split(/\s+/).filter(Boolean);
    const me = (value: string) => (value === "@me" ? VIEWER : value);
    const logins = (value: unknown) => (value as { login: string }[]).map(({ login }) => login);
    return items.filter((item) =>
      terms.every((term) => {
        const [key, raw = ""] = term.includes(":") ? [term.slice(0, term.indexOf(":")), term.slice(term.indexOf(":") + 1)] : ["", term];
        const value = me(raw.replace(/^"(.*)"$/, "$1"));
        switch (key) {
          case "is":
            if (value === "pr" || value === "issue") return true;
            if (value === "draft") return item.isDraft === true;
            return String(item.state).toLowerCase() === value;
          case "repo":
            return true;
          case "author":
            return (item.author as { login: string }).login === value;
          case "assignee":
            return logins(item.assignees).includes(value);
          case "review-requested":
            return logins(item.reviewRequests ?? []).includes(value);
          case "label":
            return (item.labels as { name: string }[]).some(({ name }) => name === value);
          case "no":
            return value === "assignee" ? (item.assignees as unknown[]).length === 0 : true;
          case "status":
            return JSON.stringify(item.statusCheckRollup ?? []).includes(value === "failure" ? "FAILURE" : "SUCCESS");
          case "":
            return String(item.title).toLowerCase().includes(value.toLowerCase());
          default:
            return true;
        }
      }),
    );
  }
}
