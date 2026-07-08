import { toolRendererRegistry } from '../registry'
import { askQuestionRenderer } from './ask-question'
import { browserRenderer } from './browser'
import { dynamicRenderer } from './dynamic'
import { fileEditRenderer } from './file-edit'
import { fileReadRenderer } from './file-read'
import { fileWriteRenderer } from './file-write'
import { globRenderer } from './glob'
import { goalRenderer } from './goal'
import { grepRenderer } from './grep'
import { multiEditRenderer } from './multi-edit'
import { shellRenderer } from './shell'
import { skillRenderer } from './skill'
import { subagentRenderer } from './subagent'
import { todoRenderer } from './todo'

toolRendererRegistry.registerMany({
  shell: shellRenderer,
  fileRead: fileReadRenderer,
  fileEdit: fileEditRenderer,
  multiEdit: multiEditRenderer,
  fileWrite: fileWriteRenderer,
  glob: globRenderer,
  grep: grepRenderer,
  skill: skillRenderer,
  spawn: subagentRenderer,
  await: subagentRenderer,
  tasks: subagentRenderer,
  steer: subagentRenderer,
  cancel: subagentRenderer,
  note: subagentRenderer,
  // Back-compat: historical conversations persist tool-call parts keyed `report`
  // (the sub-agent note tool's former name). Keep the mapping so they still render.
  report: subagentRenderer,
  todo: todoRenderer,
  updateGoal: goalRenderer,
  askQuestion: askQuestionRenderer,
  browserOpen: browserRenderer
})

toolRendererRegistry.registerComponents({
  FileCard: fileReadRenderer,
  DiffCard: fileEditRenderer,
  ShellCard: shellRenderer,
  FileListCard: globRenderer,
  MatchCard: grepRenderer,
  SkillCard: skillRenderer,
  SubagentCard: subagentRenderer,
  TodoCard: todoRenderer,
  GoalCard: goalRenderer,
  AskQuestionCard: askQuestionRenderer,
  BrowserCard: browserRenderer
})

toolRendererRegistry.registerDynamicPrefix('mcp', dynamicRenderer)

export {
  dynamicRenderer,
  fileEditRenderer,
  fileReadRenderer,
  fileWriteRenderer,
  globRenderer,
  goalRenderer,
  grepRenderer,
  multiEditRenderer,
  shellRenderer,
  skillRenderer,
  subagentRenderer,
  todoRenderer,
  askQuestionRenderer,
  browserRenderer
}
