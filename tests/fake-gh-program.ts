import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { FakeGitHub } from "./fake-gh.ts";

/**
 * The fake gh as a program for e2e hosts: FAKE_GH_STATE holds what the writes changed between runs, and FAKE_GH_LOG gets
 * each command. A checkout also switches the folder's git branch, as gh would.
 */
const statePath = process.env.FAKE_GH_STATE!;
const github = new FakeGitHub();
if (existsSync(statePath)) Object.assign(github, JSON.parse(readFileSync(statePath, "utf8")));
const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
const answer = github.answer(args);
if (answer.code === 0 && args[0] === "pr" && args[1] === "checkout") {
  const branch = github.prs.find(({ number }) => number === github.checkedOut)?.headRefName as string;
  Bun.spawnSync(["git", "checkout", "-q", "-B", branch]);
}
const { prs, issues, signedIn, checkedOut } = github;
writeFileSync(statePath, JSON.stringify({ prs, issues, signedIn, checkedOut }));
process.stdout.write(answer.stdout);
process.stderr.write(answer.stderr);
process.exit(answer.code);
