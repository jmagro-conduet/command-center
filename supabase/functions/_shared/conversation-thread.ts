export interface ThreadIssue {
  id: string
  customer_input: string | null
  suggested_response: string | null
}

export function buildConversationThread(
  ticketIssues: ThreadIssue[],
  currentId: string,
  currentInput: string
): string {
  const lines: string[] = []
  for (const ti of ticketIssues) {
    if (ti.id === currentId) break
    if (ti.customer_input?.trim())     lines.push(`Player: "${ti.customer_input.trim()}"`)
    if (ti.suggested_response?.trim()) lines.push(`Agent: "${ti.suggested_response.trim()}"`)
  }
  lines.push(`Player: "${currentInput}"`)
  return lines.join('\n')
}
