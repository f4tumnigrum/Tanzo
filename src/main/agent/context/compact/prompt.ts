export const COMPACT_PROMPT = `You are compacting a long engineering conversation so work can continue without losing critical context. Read the full transcript above, then write a summary as plain text. Do not wrap the output in XML tags or a code fence — output only the summary itself.

Cover, in order:

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

function extractSummaryText(text: string): string {
  const cleaned = text
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .replace(/<analysis>[\s\S]*$/i, '')
  const match = cleaned.match(/<summary>([\s\S]*?)(?:<\/summary>|$)/i)
  return match ? match[1] : cleaned
}

export function extractPartialSummary(text: string): string {
  return extractSummaryText(text).trimStart()
}

export function stripAnalysis(text: string): string {
  return extractSummaryText(text).trim()
}
