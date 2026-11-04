import { expect, test } from "bun:test";
import { fixCheckText, reviewText, workText } from "../github/handoff.ts";
import { issueDetail, issueItem, prDetail, prItem } from "../github/normalize.ts";
import { fillTemplate, inheritedTemplate, NO_OVERRIDES, PROMPTS, templateFor, templateSource } from "../github/prompts.ts";
import { ISSUES, PRS } from "./fixtures/github.ts";

const repo = { host: "github.com", owner: "acme", name: "widgets" };
const withChecks = prDetail(PRS[1]!);
const bare = { ...prItem(PRS[2]!), headRef: undefined, baseRef: undefined, checks: undefined, review: null };
const issue = issueDetail(ISSUES[0]!);

test("the built-in messages read as they always have", () => {
  expect({
    issueWithBody: workText(repo, issue, issue),
    issueWithout: workText(repo, issueItem(ISSUES[1]!), null),
    prWithChecks: workText(repo, withChecks, withChecks),
    prBare: workText(repo, bare, null),
    review: reviewText(repo, withChecks),
    fixCheck: fixCheckText(repo, withChecks, withChecks.checkList![0]!),
    fixCheckNoBranch: fixCheckText(repo, bare, { ...withChecks.checkList![0]!, url: null }),
  }).toMatchSnapshot();
});

test("an item's own braces stay as written, as do names the message doesn't know", () => {
  const values = { title: "Read /v4/{id}/catalogs and {url}", url: "https://example.com/1" };
  expect(fillTemplate("{title} at {url}, {nobody}", values)).toBe("Read /v4/{id}/catalogs and {url} at https://example.com/1, {nobody}");
});

test("a paragraph whose placeholders all came out empty is left out, words around them too", () => {
  expect(fillTemplate("Top\n\n{state}\n\nIts state: {state}\n\nStill {state} {title}\n\nEnd", { state: "", title: "T" })).toBe("Top\n\nStill  T\n\nEnd");
});

test("this workspace's own text wins over every workspace's, which wins over the built-in", () => {
  const every = { workspace: {}, every: { review: "Every {ref}" } };
  const both = { workspace: { review: "Here {ref}" }, every: { review: "Every {ref}" } };
  expect(templateFor("review", NO_OVERRIDES)).toBe(PROMPTS.review.builtIn);
  expect([templateFor("review", every), templateSource("review", every)]).toEqual(["Every {ref}", "every"]);
  expect([templateFor("review", both), templateSource("review", both)]).toEqual(["Here {ref}", "workspace"]);
  expect(inheritedTemplate("review", both, "workspace")).toBe("Every {ref}");
  expect(inheritedTemplate("review", both, "every")).toBe(PROMPTS.review.builtIn);
  expect(reviewText(repo, withChecks, null, both)).toBe("Here acme/widgets#405");
});
