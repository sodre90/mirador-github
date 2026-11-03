# GitHub for Mirador

A Mirador workspace-tab plugin (plugin API 7). See README.md for what it does and how to run it.

- Bun and TypeScript everywhere, strict; imports carry their `.ts`/`.tsx` extensions. React 19 for the view.
- `bun run typecheck`, `bun run test` (not a bare `bun test`, which would pick up the Playwright specs) and `scripts/e2e.sh` before every commit. The e2e uses Mirador's Playwright, which
  runs on Node: no Bun APIs in `e2e/`. Its gh is `tests/fake-gh-program.ts`, over the same `FakeGitHub` the unit tests use.
- `github/` is pure apart from `run.ts` and `tab.ts`; `host.ts` hands Mirador the tab; `view/` draws it in Mirador's
  sandboxed frame and talks to the host only through `window.mirador`. The sandbox has no `allow-forms`: no
  `<form>` submits there, so buttons and Enter keys act themselves.
- The tab's `shows` must stay cheap (no gh call) and `state` returns what's cached; fetches happen on the view's
  `refresh` and `open` actions and call `changed()` when they land.
- Every write the view offers goes through `writeArgs` in `github/gh.ts`, so the command the sheet previews is the one
  that runs.
- Names over comments: keep comments for a genuine "why" that a name can't carry.
- Every change comes with tests: logic gets unit tests, and what the user sees gets e2e coverage.
- Words the user or the agent reads: plain words and sentence case.
- Commits: authored by the owner only, with no AI attribution or trailers. One plain sentence saying what the user gets.
- Releases: bump `version` in `plugin.json` and tag the commit `v<version>`; Mirador refuses a tag that doesn't match.
