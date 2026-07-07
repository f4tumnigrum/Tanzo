export const gitKeys = {
  all: ['git'] as const,
  repo: (cwd: string) => [...gitKeys.all, cwd] as const,
  overview: (cwd: string) => [...gitKeys.repo(cwd), 'overview'] as const,
  status: (cwd: string) => [...gitKeys.repo(cwd), 'status'] as const,
  history: (cwd: string, limit?: number) =>
    [...gitKeys.repo(cwd), 'history', ...(limit === undefined ? [] : [limit])] as const,
  branches: (cwd: string) => [...gitKeys.repo(cwd), 'branches'] as const,
  remoteBranches: (cwd: string) => [...gitKeys.repo(cwd), 'remoteBranches'] as const,
  remotes: (cwd: string) => [...gitKeys.repo(cwd), 'remotes'] as const,
  user: (cwd: string) => [...gitKeys.repo(cwd), 'user'] as const,
  diff: (cwd: string, scope: string, filePath: string) =>
    [...gitKeys.repo(cwd), 'diff', scope, filePath] as const,
  commit: (cwd: string, hash: string) => [...gitKeys.repo(cwd), 'commit', hash] as const,
  commitDiff: (cwd: string, hash: string, filePath: string) =>
    [...gitKeys.repo(cwd), 'commitDiff', hash, filePath] as const
}
