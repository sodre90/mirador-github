# GitHub for Mirador

A [Mirador](https://github.com/sodre90/mirador) plugin: the issues and pull requests of a workspace's GitHub repository, in a tab beside the chat, where you find them, read them, act on them and hand them to the agent.

- **Connects by itself.** The tab finds the repository in the workspace folder's git remotes and connects once you confirm. github.com and GitHub Enterprise both work.
- **Views and filters.** Built-in views (Needs my review, Mine, Assigned to me, Failing checks…) with their counts, chips for state, author, assignee, review requested, label, checks, draft and sort, and a search box that takes any GitHub search. Save a search as a view of your own.
- **List and detail side by side.** The list shows checks, review state, linked PRs, sub-issues and assignees at a glance; the PR of the branch checked out here is pinned first. The detail has the conversation, checks and changed files.
- **Act on them.** Comment, review, merge, close or reopen, labels, assignees, ready for review, new issue, and check out a PR into the workspace. Each asks first and shows the `gh` command it runs.
- **Work on this.** Start a conversation on an issue or PR, send it to the current conversation, mention it in the composer, review a PR with the agent, or ask the agent to fix a failing check.
- **Fresh.** The list refreshes when the tab opens, every two minutes while it's visible, and after every action.
- **Keys.** `j` `k` move, `/` searches, `r` refreshes, `w` works on it, `c` comments, `o` opens it on GitHub.

Everything goes through the [GitHub CLI](https://cli.github.com) signed in on your computer (`gh auth login`); the plugin keeps no tokens. It needs Mirador with plugin API 7.

To install it, add `https://github.com/sodre90/mirador-github.git` in Settings → Plugins.

## Developing

```bash
bun install
bun run build       # the view, into dist/view.js
bun run typecheck
bun run test        # unit tests, against a fake gh
scripts/e2e.sh      # e2e in a Mirador test host from MIRADOR_DIR, with a fake gh on its PATH
```

`MIRADOR_DIR` is Mirador's checkout, by default `../visualized-claude-sessions`. `mirador/api.ts` is a copy of the plugin API types Mirador doesn't publish yet.

Releases: bump `version` in `plugin.json`, commit, and tag the commit `v<version>`. Mirador installs the newest release and offers newer ones as updates.
