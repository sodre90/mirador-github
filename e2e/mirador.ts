import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Mirador's checkout, whose test host and helpers the specs use; by default it sits next to this one. */
export const miradorDir = process.env.MIRADOR_DIR ?? join(import.meta.dirname, "..", "..", "visualized-claude-sessions");
/** The plugin as the specs install it: scripts/e2e.sh builds a copy, so the owner's own Mirador never runs a test's build. */
const pluginDir = process.env.GITHUB_PLUGIN_DIR ?? join(import.meta.dirname, "..");

type Helpers = typeof import("../../visualized-claude-sessions/e2e/helpers.ts");
type TestHostModule = typeof import("../../visualized-claude-sessions/e2e/test-host.ts");
export type TestHost = InstanceType<TestHostModule["TestHost"]>;

let loadedHelpers: Helpers | null = null;
export const helpers = () => {
  if (!loadedHelpers) throw new Error("Start the host first.");
  return loadedHelpers;
};

export type FakeGitHubState = { prs: Record<string, unknown>[]; issues: Record<string, unknown>[]; signedIn: boolean; checkedOut: number | null };

/**
 * A started Mirador test host with this plugin, a fake gh answering about acme/widgets, a project folder whose git
 * origin is that repository, and an opencode stand-in that writes each prompt to `promptsFile`.
 */
export async function startHostWithThisPlugin() {
  const { TestHost, writeBunProgram } = (await import(join(miradorDir, "e2e", "test-host.ts"))) as TestHostModule;
  loadedHelpers = (await import(join(miradorDir, "e2e", "helpers.ts"))) as Helpers;
  const host = new TestHost({ fakePrograms: true });
  const promptsFile = join(host.root, "prompts");
  const ghState = join(host.root, "gh-state.json");
  const ghLog = join(host.root, "gh-log");
  writeBunProgram(host.fakeProgramsDir, "opencode", join(miradorDir, "e2e", "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeBunProgram(host.fakeProgramsDir, "gh", join(pluginDir, "tests", "fake-gh-program.ts"), { FAKE_GH_STATE: ghState, FAKE_GH_LOG: ghLog });
  writeFileSync(promptsFile, "");
  writeFileSync(ghLog, "");
  mkdirSync(join(host.dataDir, "plugins"), { recursive: true });
  symlinkSync(pluginDir, join(host.dataDir, "plugins", "github"));
  await host.start();
  makeGitRepository(host.projectDir);
  const gh = {
    state: () => JSON.parse(readFileSync(ghState, "utf8")) as FakeGitHubState,
    change(change: (state: FakeGitHubState) => void) {
      const state = gh.state();
      change(state);
      writeFileSync(ghState, JSON.stringify(state));
    },
    commands: () =>
      readFileSync(ghLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
  return { host, promptsFile, gh };
}

function makeGitRepository(folder: string) {
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@example.invalid", ...args], { cwd: folder });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Start");
  git("remote", "add", "origin", "git@github.com:acme/widgets.git");
}
