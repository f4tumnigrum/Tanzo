import { describe, expect, it } from 'vitest'
import { parseGoalCommand } from '@shared/goal'

describe('shared/goal parseGoalCommand', () => {
  it('treats empty args as a show request', () => {
    expect(parseGoalCommand('')).toEqual({ op: 'show' })
    expect(parseGoalCommand('   ')).toEqual({ op: 'show' })
  })

  it('recognizes control keywords case-insensitively', () => {
    expect(parseGoalCommand('clear')).toEqual({ op: 'clear' })
    expect(parseGoalCommand('PAUSE')).toEqual({ op: 'pause' })
    expect(parseGoalCommand('  Resume ')).toEqual({ op: 'resume' })
  })

  it('treats any other args as an objective to set', () => {
    expect(parseGoalCommand('ship the release')).toEqual({
      op: 'set',
      objective: 'ship the release'
    })
  })

  it('trims the objective but preserves inner spacing', () => {
    expect(parseGoalCommand('  fix   the  bug  ')).toEqual({
      op: 'set',
      objective: 'fix   the  bug'
    })
  })
})
