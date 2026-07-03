import type { AskQuestionAnswer, AskQuestionInput, AskQuestionOutput } from '@shared/agent-message'
import type { PendingQuestion } from '@shared/chat'

export type QuestionReply =
  { kind: 'answers'; answers: AskQuestionAnswer[] } | { kind: 'declined'; note?: string }

/**
 * Default timeout before an unanswered question self-resolves as declined.
 * Prevents a turn from hanging forever when the user closes the panel without
 * explicitly answering or cancelling. 30 minutes is generous enough for a real
 * user working at the desk but short enough to avoid indefinite slot starvation.
 */
const DEFAULT_QUESTION_TIMEOUT_MS = 30 * 60_000

export interface QuestionBroker {
  ask(
    chatId: string,
    questionId: string,
    input: AskQuestionInput,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<AskQuestionOutput>
  respond(chatId: string, questionId: string, reply: QuestionReply): Promise<void>
  clearForChat(chatId: string): void
}

interface PendingQuestionState {
  payload: PendingQuestion
  resolve: (output: AskQuestionOutput) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

function abortError(): Error {
  return Object.assign(new Error('Question was cancelled.'), { name: 'AbortError' })
}

function validateAnswers(input: AskQuestionInput, answers: AskQuestionAnswer[]): void {
  const byId = new Map(input.questions.map((q) => [q.id, q]))
  for (const answer of answers) {
    const question = byId.get(answer.id)
    if (!question) throw new Error(`Answer references unknown question "${answer.id}".`)
    if (answer.type !== question.type) {
      throw new Error(`Answer type for question "${answer.id}" does not match the question.`)
    }
    if (answer.values.length === 0) {
      throw new Error(`Answer for question "${answer.id}" must include at least one value.`)
    }
    if (question.type === 'single_select' && answer.values.length !== 1) {
      throw new Error(`Question "${answer.id}" accepts a single value.`)
    }

    const optionValues = new Set(question.options.map((option) => option.value))

    if (answer.custom) {
      if (!question.allowCustom) {
        throw new Error(`Question "${answer.id}" does not allow custom answers.`)
      }
      if (new Set(answer.values).size !== answer.values.length) {
        throw new Error(`Answer for question "${answer.id}" has duplicate values.`)
      }
      continue
    }

    const seen = new Set<string>()
    for (const value of answer.values) {
      if (!optionValues.has(value)) {
        throw new Error(`Answer value for question "${answer.id}" is not a valid option.`)
      }
      if (seen.has(value)) {
        throw new Error(`Answer for question "${answer.id}" has duplicate values.`)
      }
      seen.add(value)
    }

    if (question.type === 'rank_priorities' && answer.values.length !== question.options.length) {
      throw new Error(`Question "${answer.id}" requires ranking every option exactly once.`)
    }
  }
}

export function createQuestionBroker(): QuestionBroker {
  const pending = new Map<string, PendingQuestionState>()

  /**
   * Remove the question from `pending`, clear its timer, and return the state
   * so the caller can settle it. Idempotent — returns undefined when already cleared.
   */
  function clear(questionId: string): PendingQuestionState | undefined {
    const state = pending.get(questionId)
    if (!state) return undefined
    pending.delete(questionId)
    if (state.timer !== undefined) clearTimeout(state.timer)
    return state
  }

  return {
    ask(chatId, questionId, input, signal, timeoutMs = DEFAULT_QUESTION_TIMEOUT_MS) {
      const existing = clear(questionId)
      existing?.reject(new Error('Question was replaced by a newer request.'))

      return new Promise<AskQuestionOutput>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError())
          return
        }

        const settle = (output: AskQuestionOutput): void => {
          signal?.removeEventListener('abort', onAbort)
          resolve(output)
        }

        const onAbort = (): void => {
          clear(questionId)
          reject(abortError())
        }

        // Auto-resolve as declined after the timeout window so the agent turn
        // is never stuck waiting for a user who closed the panel or walked away.
        const timer = setTimeout(() => {
          // clear() removes from map and clears the timer reference itself;
          // use the returned state to guard against a race where respond() fired
          // concurrently with the timer callback.
          const s = clear(questionId)
          if (s) {
            signal?.removeEventListener('abort', onAbort)
            s.resolve({
              declined: true,
              note: 'Question timed out: no response within the allowed window.'
            })
          }
        }, timeoutMs)

        pending.set(questionId, {
          payload: { chatId, questionId, input },
          resolve: settle,
          reject: (error) => {
            signal?.removeEventListener('abort', onAbort)
            reject(error)
          },
          timer
        })
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },

    async respond(chatId, questionId, reply) {
      const state = clear(questionId)
      if (!state) throw new Error('Question is no longer pending.')
      if (state.payload.chatId !== chatId) throw new Error('Question does not belong to this chat.')
      if (reply.kind === 'declined') {
        state.resolve(reply.note ? { declined: true, note: reply.note } : { declined: true })
        return
      }
      try {
        validateAnswers(state.payload.input, reply.answers)
      } catch (error) {
        state.reject(error instanceof Error ? error : new Error(String(error)))
        throw error
      }
      state.resolve({ answers: reply.answers })
    },

    clearForChat(chatId) {
      for (const state of [...pending.values()]) {
        if (state.payload.chatId !== chatId) continue
        clear(state.payload.questionId)?.reject(abortError())
      }
    }
  }
}
