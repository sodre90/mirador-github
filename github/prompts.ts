import type { Check, Detail, ListItem } from "./model.ts";
import { repoArg, repoLabel, type RepoRef } from "./remote.ts";

export type PromptKind = "work-issue" | "work-pr" | "review" | "fix-check";

/** The user's own text for a message, this workspace's and every workspace's; a level without one uses the next. */
export interface PromptOverrides {
  workspace: Partial<Record<PromptKind, string>>;
  every: Partial<Record<PromptKind, string>>;
}

export type PromptScope = keyof PromptOverrides;

export const NO_OVERRIDES: PromptOverrides = { workspace: {}, every: {} };

interface Placeholder {
  name: string;
  means: string;
}

interface Prompt {
  name: string;
  /** Which of the tab's buttons sends it, as a sentence. */
  sentBy: string;
  placeholders: Placeholder[];
  builtIn: string;
}

const ITEM: Placeholder[] = [
  { name: "ref", means: "the item as GitHub links it, such as acme/widgets#412" },
  { name: "number", means: "its number" },
  { name: "title", means: "its title" },
  { name: "url", means: "its page on GitHub" },
  { name: "repo", means: "the repository as gh -R takes it" },
];

const STANDING: Placeholder[] = [
  { name: "branches", means: '" (head → base)", or nothing when unknown' },
  { name: "state", means: "how its checks and reviews stand" },
];

const DESCRIPTION: Placeholder = { name: "description", means: "its description, the first 4000 characters" };

export const PROMPTS: Record<PromptKind, Prompt> = {
  "work-issue": {
    name: "Work on an issue",
    sentBy: "Work on this sends it for an issue.",
    placeholders: [...ITEM, DESCRIPTION],
    builtIn: [
      'Work on GitHub issue {ref}: "{title}"',
      "{url}",
      "{description}",
      "Read its comments with `gh issue view {number} -R {repo} --comments`. Don't post to GitHub unless I ask.",
    ].join("\n\n"),
  },
  "work-pr": {
    name: "Work on a pull request",
    sentBy: "Work on this sends it for a pull request.",
    placeholders: [...ITEM, ...STANDING, DESCRIPTION],
    builtIn: [
      'Work on pull request {ref}: "{title}"{branches}',
      "{url}",
      "{state}",
      "{description}",
      "Read its reviews and comments with `gh pr view {number} -R {repo} --comments`, and its diff with `gh pr diff {number} -R {repo}`. Don't post to GitHub unless I ask.",
    ].join("\n\n"),
  },
  review: {
    name: "Review a pull request",
    sentBy: "Review with the agent sends it.",
    placeholders: [...ITEM, ...STANDING, DESCRIPTION],
    builtIn: [
      'Review pull request {ref}: "{title}"',
      "{url}",
      "Get its diff with `gh pr diff {number} -R {repo}` and its description with `gh pr view {number} -R {repo}`. Review it for correctness, design and tests, and publish your review on the canvas with the review tool. Don't post anything to GitHub.",
    ].join("\n\n"),
  },
  "fix-check": {
    name: "Fix a failing check",
    sentBy: "Ask the agent to fix, on a failing check, sends it.",
    placeholders: [
      ...ITEM,
      { name: "check", means: "the check's name" },
      { name: "checkUrl", means: "the check's page, else the pull request's" },
      { name: "head", means: "the pull request's branch" },
      { name: "onBranch", means: '" on the branch <head>", or nothing when unknown' },
    ],
    builtIn: [
      'The check "{check}" fails on pull request {ref}: "{title}".',
      "{checkUrl}",
      "Find out why, e.g. with `gh pr checks {number} -R {repo}` and `gh run view --log-failed`, and fix it{onBranch}.",
    ].join("\n\n"),
  },
};

export const PROMPT_KINDS = Object.keys(PROMPTS) as PromptKind[];

/** The text a level starts from when it has none of its own. */
export function inheritedTemplate(kind: PromptKind, overrides: PromptOverrides, scope: PromptScope): string {
  return (scope === "workspace" ? overrides.every[kind] : undefined) ?? PROMPTS[kind].builtIn;
}

export const templateFor = (kind: PromptKind, overrides: PromptOverrides) => overrides.workspace[kind] ?? inheritedTemplate(kind, overrides, "workspace");

/** Where the text in use comes from, for the sheet to say. */
export const templateSource = (kind: PromptKind, overrides: PromptOverrides): "workspace" | "every" | "built-in" =>
  overrides.workspace[kind] !== undefined ? "workspace" : overrides.every[kind] !== undefined ? "every" : "built-in";

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The template with its placeholders filled in one pass, so braces in an item's own text stay as they are, and unknown
 * names stay as written. A paragraph whose placeholders all came out empty is left out.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template
    .split(/\n{2,}/)
    .flatMap((paragraph) => {
      const names = [...paragraph.matchAll(PLACEHOLDER)].map(([, name]) => name!).filter((name) => name in values);
      if (names.length > 0 && names.every((name) => !values[name]!.trim())) return [];
      return [paragraph.replace(PLACEHOLDER, (written, name: string) => (name in values ? values[name]! : written))];
    })
    .join("\n\n")
    .trim();
}

const MOST_BODY = 4000;

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

/** What every placeholder of an item stands for. */
export function itemValues(repo: RepoRef, item: ListItem, detail: Detail | null): Record<string, string> {
  return {
    ref: `${repoLabel(repo)}#${item.number}`,
    number: String(item.number),
    title: item.title,
    url: item.url,
    repo: repoArg(repo),
    branches: item.headRef && item.baseRef ? ` (${item.headRef} → ${item.baseRef})` : "",
    state: [checksLine(item, detail), reviewLine(item)].filter(Boolean).join(" "),
    description: bodyOf(detail),
  };
}

export const checkValues = (repo: RepoRef, item: ListItem, check: Check): Record<string, string> => ({
  ...itemValues(repo, item, null),
  check: check.name,
  checkUrl: check.url ?? item.url,
  head: item.headRef ?? "",
  onBranch: item.headRef ? ` on the branch ${item.headRef}` : "",
});

export const workKind = (item: ListItem): PromptKind => (item.kind === "issue" ? "work-issue" : "work-pr");

/** One level's stored texts, as far as they are texts of known messages. */
export function promptLevelOf(value: unknown): Partial<Record<PromptKind, string>> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([kind, text]) => kind in PROMPTS && typeof text === "string")) as Partial<Record<PromptKind, string>>;
}

/**
 * The level as it is with the text set, or taken out with null. A text the same as what the level would inherit is
 * taken out too, so a later change to the built-in, or to every workspace's, still reaches it.
 */
export function withPrompt(overrides: PromptOverrides, scope: PromptScope, kind: PromptKind, text: string | null): Partial<Record<PromptKind, string>> {
  const { [kind]: _left, ...rest } = overrides[scope];
  if (text === null || text.trim() === inheritedTemplate(kind, overrides, scope).trim()) return rest;
  return { ...rest, [kind]: text };
}
