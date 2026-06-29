import { CollapsibleGrid } from '@/components/ui/collapsible-grid'
import type { SkillSummary } from '@shared/skills'
import { SkillCard } from './skill-card'

interface SkillsGridProps {
  title: string
  skills: SkillSummary[]
  defaultOpen?: boolean
  pageSize?: number
  onOpen: (skill: SkillSummary) => void
  onToggle: (skill: SkillSummary, enabled: boolean) => void
}

export function SkillsGrid({
  title,
  skills,
  defaultOpen = true,
  pageSize,
  onOpen,
  onToggle
}: SkillsGridProps): React.ReactElement {
  return (
    <CollapsibleGrid
      title={title}
      items={skills}
      getItemKey={(skill) => skill.name}
      defaultOpen={defaultOpen}
      pageSize={pageSize}
      renderItem={(skill) => <SkillCard skill={skill} onOpen={onOpen} onToggle={onToggle} />}
    />
  )
}
