import type { Check, Detail, ListItem } from "./model.ts";
import { repoArg, repoLabel, type RepoRef } from "./remote.ts";

const MOST_BODY = 4000;

const reference = (repo: RepoRef, item: ListItem) => `${repoLabel(repo)}#${item.number}`;

const bodyOf = (detail: Detail | null) => {
  const body = detail?.body.trim() ?? "";
  if (!body) return "";
  return body.length > MOST_BODY ? `${body.slice(0, MOST_BODY)}\n\n(The description goes on; gh has the rest.)` : body;
};

const checksLine = (item: ListItem, detail: Detail | null) => {
  if (!item.checks || item.checks.total === 0) return null;
  const failing = (detail?.checkList ?? []).filter(({ state }) => state === "failed").map(({ name }) => name);
  if (item.checks.failed > 0) return `Checks: ${item.checks.failed} failing${failing.length ? ` (${failing.join(", ")})` : ""}.`;
  if (item.checks.pending > 0) return `Checks: ${item.checks.pending} still running.`;
  return "Checks: all passing.";
};

const REVIEW_LINES = { approved: "Review: approved.", "changes-requested": "Review: changes requested.", "review-required": "Review: waiting for a review." } as const;

const reviewLine = (item: ListItem) => (item.review ? REVIEW_LINES[item.review] : null);

/** The agent's first message about an issue or PR: what it is, where it is, its state, and how to read more with gh. */
export function workText(repo: RepoRef, item: ListItem, detail: Detail | null): string {
  const R = repoArg(repo);
  if (item.kind === "issue") {
    return [
      `Work on GitHub issue ${reference(repo, item)}: "${item.title}"`,
      item.url,
      bodyOf(detail),
      `Read its comments with \`gh issue view ${item.number} -R ${R} --comments\`. Don't post to GitHub unless I ask.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const branches = item.headRef && item.baseRef ? ` (${item.headRef} → ${item.baseRef})` : "";
  return [
    `Work on pull request ${reference(repo, item)}: "${item.title}"${branches}`,
    item.url,
    [checksLine(item, detail), reviewLine(item)].filter(Boolean).join(" "),
    bodyOf(detail),
    `Read its reviews and comments with \`gh pr view ${item.number} -R ${R} --comments\`, and its diff with \`gh pr diff ${item.number} -R ${R}\`. Don't post to GitHub unless I ask.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What goes in the composer: the item named the way GitHub links it, with its title. */
export const mentionText = (repo: RepoRef, item: ListItem) => `${reference(repo, item)} ("${item.title}")`;

export const reviewText = (repo: RepoRef, item: ListItem) =>
  [
    `Review pull request ${reference(repo, item)}: "${item.title}"`,
    item.url,
    `Get its diff with \`gh pr diff ${item.number} -R ${repoArg(repo)}\` and its description with \`gh pr view ${item.number} -R ${repoArg(repo)}\`. Review it for correctness, design and tests, and publish your review on the canvas with the review tool. Don't post anything to GitHub.`,
  ].join("\n\n");

export const fixCheckText = (repo: RepoRef, item: ListItem, check: Check) =>
  [
    `The check "${check.name}" fails on pull request ${reference(repo, item)}: "${item.title}".`,
    check.url ?? item.url,
    `Find out why, e.g. with \`gh pr checks ${item.number} -R ${repoArg(repo)}\` and \`gh run view --log-failed\`, and fix it on the branch ${item.headRef ?? ""}.`.replace(" on the branch .", "."),
  ].join("\n\n");
