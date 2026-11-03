/** A repository on GitHub or a GitHub Enterprise server. */
export interface RepoRef {
  host: string;
  owner: string;
  name: string;
}

/** A git remote of the workspace that points at a GitHub repository. */
export interface RemoteCandidate {
  remote: string;
  repo: RepoRef;
}

export const GITHUB_COM = "github.com";

const SCP_LIKE = /^(?:[\w.-]+@)?([\w.-]+):\/?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const URL_LIKE = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const SHORT = /^([\w.-]+)\/([\w.-]+)$/;
const HOST_SHORT = /^([\w-]+(?:\.[\w-]+)+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;

/** A remote's URL, an owner/name, or a host/owner/name, as a repository; null for anything else. */
export function parseRepo(text: string): RepoRef | null {
  const trimmed = text.trim();
  const short = SHORT.exec(trimmed);
  if (short) return { host: GITHUB_COM, owner: short[1]!, name: short[2]! };
  const match = URL_LIKE.exec(trimmed) ?? HOST_SHORT.exec(trimmed) ?? SCP_LIKE.exec(trimmed);
  if (!match) return null;
  const host = match[1]!.toLowerCase().replace(/^ssh\./, "");
  return { host, owner: match[2]!, name: match[3]! };
}

/** The remotes of `git remote -v`, once each, origin and upstream first. */
export function remoteCandidates(gitRemoteOutput: string): RemoteCandidate[] {
  const seen = new Map<string, RemoteCandidate>();
  for (const line of gitRemoteOutput.split("\n")) {
    const [remote, url] = line.trim().split(/\s+/);
    const repo = remote && url ? parseRepo(url) : null;
    if (remote && repo && !seen.has(remote)) seen.set(remote, { remote, repo });
  }
  const rank = (remote: string) => ["origin", "upstream"].indexOf(remote) >>> 0;
  return [...seen.values()].sort((a, b) => rank(a.remote) - rank(b.remote));
}

/** How `gh -R` names it: github.com repositories without their host. */
export const repoArg = ({ host, owner, name }: RepoRef) => (host === GITHUB_COM ? `${owner}/${name}` : `${host}/${owner}/${name}`);

export const repoLabel = ({ owner, name }: RepoRef) => `${owner}/${name}`;

export const repoUrl = ({ host, owner, name }: RepoRef) => `https://${host}/${owner}/${name}`;

export const sameRepo = (a: RepoRef | null, b: RepoRef | null) => !!a && !!b && a.host === b.host && a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();
