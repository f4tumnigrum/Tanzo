export const COMPACT_PROMPT = `You are compacting a long engineering conversation so work can continue without losing critical context. Read the full transcript above, then produce a structured summary.

First, think privately inside a single <analysis>...</analysis> block: identify what matters, what is in-flight, and what must not be forgotten. This scratchpad will be discarded.

Then write the final summary inside a single <summary>...</summary> block, using exactly these sections:

1. Primary request and intent — what the user is ultimately trying to achieve, in their own framing.
2. Key technical concepts — frameworks, patterns, constraints, and decisions established.
3. Files and code — for every file touched or examined, the path and the relevant code segments (include full snippets where they carry meaning).
4. Errors and fixes — failures encountered and how they were resolved.
5. Problem solving — the reasoning and approaches that worked or were rejected.
6. All user messages — every non-trivial user message, verbatim, preserving intent and ordering.
7. Pending tasks — what remains to be done.
8. Current work — precisely what was being worked on at the moment of this summary.
9. Next step — the single most immediate next action, if one is clearly implied.

Be specific and complete. Preserve exact identifiers, signatures, and paths. Do not invent facts not present in the transcript.`

export function extractPartialSummary(text: string): string {
  // Strip completed <analysis> blocks first so their content cannot confuse
  // the tag search below (the prompt instructs the model to think inside
  // <analysis> before writing <summary>, so this block often precedes it).
  const cleaned = text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')

  // Match everything between <summary> and </summary>, or between <summary>
  // and end-of-text while the model is still streaming (partial output).
  const match = cleaned.match(/<summary>([\s\S]*?)(?:<\/summary>|$)/i)
  return match ? match[1].trimStart() : ''
}

export function stripAnalysis(text: string): string {
  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i)
  if (summaryMatch && summaryMatch[1]) return summaryMatch[1].trim()
  return text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim()
}
