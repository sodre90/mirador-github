import type { CanvasHost } from "./mirador/api.ts";
import { GitHubTab } from "./github/tab.ts";

/** Issues and pull requests of the workspace's GitHub repository, in a tab of its canvas, through the gh signed in on this computer. */
const host: CanvasHost = { items: {}, tools: {}, workspaceTab: new GitHubTab() };

export default host;
