import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { helpers, startHostWithThisPlugin, type TestHost } from "./mirador.ts";

let host: TestHost;
let promptsFile: string;
let gh: Awaited<ReturnType<typeof startHostWithThisPlugin>>["gh"];
const agentSaw = () => readFileSync(promptsFile, "utf8");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ({ host, promptsFile, gh } = await startHostWithThisPlugin());
});
test.afterAll(async () => {
  await host?.stop();
  await host?.cleanUp();
});

const tab = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.workspace-tab iframe");
const sheet = (page: Page) => tab(page).getByRole("dialog");
const gitHubToggle = (page: Page) => page.locator(".canvas-panel:visible .workspace-tab-toggle", { hasText: "GitHub" });
/** With GITHUB_SCREENSHOTS naming a folder, the canvas pane as the step leaves it, for the README and the plugin store. */
const shoot = async (page: Page, name: string) => {
  const folder = process.env.GITHUB_SCREENSHOTS;
  if (folder) await page.locator(".canvas-panel:visible").screenshot({ path: join(folder, `${name}.png`) });
};
const row = (page: Page, number: number) => tab(page).locator(`.row[data-number="${number}"]`);

async function openConversation(page: Page) {
  const { addWorkspace, createProfile, signIn } = helpers();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "github", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "github · opencode" });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

test("a workspace connects to its GitHub repository, and its issues and pull requests are found, read and acted on", async ({ page }) => {
  await openConversation(page);

  await test.step("the tab finds the repository in the folder's git remotes and connects once the user confirms", async () => {
    await gitHubToggle(page).click();
    await expect(tab(page).getByRole("heading", { name: "Connect this workspace to GitHub" })).toBeVisible();
    await expect(tab(page).getByRole("radio", { name: /acme\/widgets/ })).toBeChecked();
    await tab(page).getByRole("button", { name: "Connect" }).click();
    await expect(row(page, 412)).toContainText("Reorder queued messages by dragging");
    await expect(tab(page).getByRole("tab", { name: /Pull requests/ }).locator(".count")).toHaveText("3");
    await expect(tab(page).getByRole("tab", { name: /Issues/ }).locator(".count")).toHaveText("2");
  });

  await test.step("views and the search narrow the list", async () => {
    await tab(page).getByRole("button", { name: /^Needs my review/ }).click();
    await expect(row(page, 405)).toBeVisible();
    await expect(row(page, 412)).toHaveCount(0);
    await expect(row(page, 405)).toContainText("asks your review");
    await tab(page).getByLabel("Search").fill("is:open author:sodre90");
    await tab(page).getByLabel("Search").press("Enter");
    await expect(row(page, 409)).toBeVisible();
    await expect(row(page, 405)).toHaveCount(0);
    await tab(page).getByRole("button", { name: /^All open/ }).click();
    await expect(tab(page).locator(".row")).toHaveCount(3);
    await shoot(page, "list");
  });

  await test.step("the Review requested chip narrows to whose review is asked, and Me is the Needs my review view", async () => {
    await tab(page).getByRole("button", { name: "Review requested ▾" }).click();
    await tab(page).getByRole("option", { name: "Me (sodre90)" }).click();
    await expect(tab(page).getByRole("button", { name: /^Needs my review/ })).toHaveAttribute("aria-pressed", "true");
    await expect(tab(page).locator(".row")).toHaveCount(1);
    await expect(row(page, 405)).toBeVisible();
    await tab(page).getByRole("button", { name: "Review requested: @me ▾" }).click();
    await tab(page).getByRole("option", { name: "lena-ortiz" }).click();
    await expect(tab(page).getByLabel("Search")).toHaveValue("is:open review-requested:lena-ortiz");
    await expect(tab(page).locator(".row")).toHaveCount(1);
    await expect(row(page, 409)).toBeVisible();
    await tab(page).getByRole("button", { name: /^All open/ }).click();
  });

  await test.step("a menu at the frame's right edge opens toward the left, so all of it shows", async () => {
    await tab(page).locator(".filters").evaluate((filters) => ((filters as HTMLElement).style.justifyContent = "flex-end"));
    await tab(page).getByRole("button", { name: "Sort ▾" }).click();
    const menu = tab(page).locator(".popover");
    await expect(menu.getByRole("option", { name: "Least recently updated" })).toBeVisible();
    const { left, right, frameWidth } = await menu.evaluate((element) => ({ ...element.getBoundingClientRect().toJSON(), frameWidth: document.documentElement.clientWidth }));
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(frameWidth);
    await tab(page).getByLabel("Search").click();
    await tab(page).locator(".filters").evaluate((filters) => ((filters as HTMLElement).style.justifyContent = ""));
  });

  await test.step("a pull request shows beside the list, with its checks and files", async () => {
    await row(page, 405).click();
    const detail = tab(page).locator(".detail");
    await expect(detail.locator(".detail-title")).toContainText("Fix canvas resize on narrow panes");
    await expect(detail).toContainText("Still clips at 360 px.");
    const review = detail.locator(".entry.review", { hasText: "Still clips at 360 px." });
    await expect(review.locator(".verdict")).toHaveText("requested changes");
    await expect(review).toHaveCSS("border-top-width", "0px");
    await expect(review.locator(".markdown")).not.toHaveCSS("color", await review.locator(".verdict").evaluate((verdict) => getComputedStyle(verdict).color));
    await detail.getByRole("tab", { name: /Checks/ }).click();
    await expect(detail.locator(".checks-list li.failed").first()).toBeVisible();
    await shoot(page, "checks");
    await detail.getByRole("button", { name: "Ask the agent to fix" }).first().click();
    await expect.poll(agentSaw).toContain("#405");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
    await detail.getByRole("tab", { name: /Files/ }).click();
    await expect(detail.locator(".file-row").first()).toBeVisible();
  });

  await test.step("the symbol-only menu buttons have names, and drop their hint while their menu is open", async () => {
    const detail = tab(page).locator(".detail");
    const handOff = detail.getByRole("button", { name: "More ways to hand it to the agent" });
    await expect(handOff).toHaveAttribute("data-hint", "More ways to hand it to the agent");
    await handOff.click();
    await expect(handOff).toHaveAttribute("aria-expanded", "true");
    await expect(handOff).not.toHaveAttribute("data-hint");
    await handOff.click();
    const more = detail.getByRole("button", { name: "More", exact: true });
    await more.click();
    await expect(more).not.toHaveAttribute("data-hint");
    await more.click();
  });

  await test.step("a comment shows the gh command it runs, and appears once posted", async () => {
    await tab(page).locator(".detail").getByRole("tab", { name: /Conversation/ }).click();
    await tab(page).locator("#comment-button").click();
    await sheet(page).getByLabel("Comment").fill("Looks better at 360 px now.");
    await expect(sheet(page).locator(".command")).toHaveText(/gh pr comment 405 -R acme\/widgets --body 'Looks better at 360 px now\.'/);
    await sheet(page).getByRole("button", { name: "Post to GitHub" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(tab(page).locator(".toast")).toHaveText("Posted your comment");
    await expect(tab(page).locator(".detail")).toContainText("Looks better at 360 px now.");
  });

  await test.step("merging asks first, warns of failing checks, and then the pull request shows as merged", async () => {
    await tab(page).locator(".detail").getByRole("button", { name: "Merge…" }).click();
    await expect(sheet(page)).toContainText("failing");
    await sheet(page).getByRole("button", { name: "Merge on GitHub" }).click();
    await expect(tab(page).locator(".detail .state-badge")).toHaveText(/Merged/);
    expect(gh.state().prs.find(({ number }) => number === 405)?.state).toBe("MERGED");
  });

  await test.step("an issue goes to the agent in a new conversation of this workspace", async () => {
    await tab(page).getByRole("tab", { name: /Issues/ }).click();
    await row(page, 60).click();
    await expect(tab(page).locator(".detail")).toContainText("Plugins gallery in the main UI");
    const previousUrl = page.url();
    await tab(page).locator("#work-on-this").click();
    await expect(page).not.toHaveURL(previousUrl);
    await expect.poll(agentSaw).toContain("Plugins gallery in the main UI");
  });

  await test.step("the new conversation's GitHub tab is the same, still connected", async () => {
    await gitHubToggle(page).click();
    await expect(row(page, 60)).toBeVisible();
  });

  await test.step("a pull request is checked out in the workspace after the user confirms", async () => {
    await tab(page).getByRole("tab", { name: /Pull requests/ }).click();
    await row(page, 409).click();
    await tab(page).locator(".detail").getByRole("button", { name: /Check out/ }).click();
    await expect(sheet(page).locator(".command")).toHaveText("gh pr checkout 409 -R acme/widgets");
    await sheet(page).getByRole("button", { name: "Check out", exact: true }).click();
    await expect(row(page, 409)).toContainText("checked out here");
    const branch = execFileSync("git", ["branch", "--show-current"], { cwd: host.projectDir, encoding: "utf8" }).trim();
    expect(branch).toBe("phone-tabs");
  });

  await test.step("a workspace's own review prompt is kept for it, and every workspace's stays the built-in", async () => {
    await tab(page).locator(".repo-button").click();
    await tab(page).getByRole("button", { name: "Prompts for the agent…" }).click();
    await sheet(page).getByLabel("Prompt", { exact: true }).selectOption({ label: "Review a pull request" });
    await sheet(page).getByLabel("Prompt text").fill("Review {ref} against the team checklist: {url}");
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(tab(page).locator(".toast")).toHaveText("Saved the prompt");
    await expect(sheet(page).locator(".sheet-about")).toContainText("This workspace uses this workspace's own text.");
    await shoot(page, "prompts");
    await sheet(page).getByRole("button", { name: "Every workspace" }).click();
    await expect(sheet(page).getByLabel("Prompt text")).toHaveValue(/Review it for correctness, design and tests/);
    await expect(sheet(page).locator(".sheet-about")).toContainText("This workspace has its own text");
    await sheet(page).getByRole("button", { name: "Close" }).click();
  });

  await test.step("Edit the message first changes what this one review asks, not the saved prompt", async () => {
    const detail = tab(page).locator(".detail");
    await detail.getByRole("button", { name: "More ways to hand it to the agent" }).click();
    await detail.getByRole("button", { name: /Edit the message first/ }).click();
    await expect(sheet(page).getByRole("button", { name: "Review it" })).toHaveAttribute("aria-pressed", "true");
    const message = sheet(page).getByLabel("Message", { exact: true });
    await expect(message).toHaveValue("Review acme/widgets#409 against the team checklist: https://github.com/acme/widgets/pull/409");
    await message.fill("Review acme/widgets#409 against the team checklist: https://github.com/acme/widgets/pull/409 Only the tests, please.");
    const previousUrl = page.url();
    await sheet(page).getByRole("button", { name: "Start a conversation" }).click();
    await expect(page).not.toHaveURL(previousUrl);
    await expect.poll(agentSaw).toContain("against the team checklist: https://github.com/acme/widgets/pull/409 Only the tests, please.");
    await gitHubToggle(page).click();
    await tab(page).locator(".repo-button").click();
    await tab(page).getByRole("button", { name: "Prompts for the agent…" }).click();
    await sheet(page).getByLabel("Prompt", { exact: true }).selectOption({ label: "Review a pull request" });
    await expect(sheet(page).getByLabel("Prompt text")).toHaveValue("Review {ref} against the team checklist: {url}");
    await sheet(page).getByRole("button", { name: "Put back the built-in" }).click();
    await expect(sheet(page).getByLabel("Prompt text")).toHaveValue(/Review it for correctness, design and tests/);
    await expect(sheet(page).locator(".sheet-about")).toContainText("This workspace uses the built-in text.");
    await sheet(page).getByRole("button", { name: "Close" }).click();
  });

  await test.step("when gh is signed out the tab says how to sign in, and comes back once it is", async () => {
    gh.change((state) => (state.signedIn = false));
    await tab(page).getByRole("button", { name: "Refresh" }).click();
    await expect(tab(page).getByRole("heading", { name: "gh isn't signed in to github.com" })).toBeVisible();
    await expect(tab(page).locator(".command")).toHaveText("gh auth login");
    gh.change((state) => (state.signedIn = true));
    await tab(page).getByRole("button", { name: "Try again" }).click();
    await expect(row(page, 412)).toBeVisible();
  });
});
