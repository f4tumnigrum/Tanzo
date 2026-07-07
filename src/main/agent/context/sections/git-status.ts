import type { ContextSection } from '../section'

export interface GitStatusReader {
  read: (cwd: string) => string | null
}

export function createGitStatusSection(reader: GitStatusReader): ContextSection {
  return {
    id: 'git-status',
    stability: 'volatile',
    channel: 'injection',
    order: 10,
    render: ({ cwd, isFirstTurn }) => {
      if (isFirstTurn === false) return null
      const status = reader.read(cwd)?.trim()
      if (!status) return null
      return [
        '<git-status>',
        'Snapshot of git status taken at the start of the conversation. It does not update as you work — run git yourself for the current state.',
        status,
        '</git-status>'
      ].join('\n')
    }
  }
}
