import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders } from '../_shared/cors.ts'

interface ReportRequest {
  period: string
  audience: string
  focusArea: string
  metrics: {
    ticketCount: number
    totalResponses: number
    avgPerTicket: string
    avgPerDay: string
    perfectPct: string
    majorityPct: string
    partialPct: string
    noRespPct: string
    targetRange: string
  }
  topAgents: Array<{
    name: string
    tickets: number
    perfectRate: string
  }>
  categoryBreakdown: Array<{
    name: string
    vol: number
    perfectPct: string
    noRespPct: string
    status: string
  }>
}

function buildPrompt(req: ReportRequest): string {
  const { period, audience, focusArea, metrics, topAgents, categoryBreakdown } = req

  const audienceTone: Record<string, string> = {
    'Executive (CPO/COO/CTO)': 'strategic and concise. Focus on business outcomes, automation readiness, and high-level trends. Skip granular agent detail unless a headline number warrants it.',
    'Operations Manager':       'detailed and process-oriented. Cover agent performance, category gaps, and workflow efficiency. Include specific numbers throughout.',
    'CS Team Lead':             'team-focused and motivating. Acknowledge wins, surface coaching opportunities, and give clear next actions for agents.',
    'Client / Operator':        'professional and external-facing. Focus on response quality, coverage, and continuous improvement. Avoid internal jargon.',
  }

  const focusTone: Record<string, string> = {
    'Balanced overview':    'Provide equal weight across volume, quality, agent performance, and category coverage.',
    'Agent performance':    'Lead with and emphasise individual agent data — volume vs target, perfect rate, and trajectory.',
    'gameLM quality':       'Lead with response quality metrics — perfect rate, edit rates, no-response rate, and what they mean for automation readiness.',
    'Category breakdown':   'Lead with category-level data. Highlight which categories are autopilot-ready and which have blockers.',
    'Event impact':         'Consider how event periods may have influenced volume and quality trends.',
  }

  const agentTable = topAgents.length > 0
    ? topAgents.map(a => `  - ${a.name}: ${a.tickets} tickets, ${a.perfectRate} perfect rate`).join('\n')
    : '  No agent data available'

  const catTable = categoryBreakdown.length > 0
    ? categoryBreakdown.map(c => `  - ${c.name}: ${c.vol} responses, ${c.perfectPct} perfect, ${c.noRespPct} no-response — ${c.status}`).join('\n')
    : '  No category data available'

  return `You are a senior CS analytics expert for a sports betting operator using gameLM, an AI-powered customer support assistant. gameLM suggests responses to customer queries; agents review and categorise each response as Perfect (no edits), Majority edit, Partial edit, or No response.

Generate a performance report for the following audience: **${audience}**
Tone: ${audienceTone[audience] ?? 'professional and data-driven.'}

Period: ${period}
Focus area: ${focusArea}
${focusTone[focusArea] ?? ''}

RAW DATA
--------
Volume:
  - Tickets logged: ${metrics.ticketCount}
  - Total gameLM responses logged: ${metrics.totalResponses}
  - Avg responses per ticket: ${metrics.avgPerTicket}
  - Avg tickets per day: ${metrics.avgPerDay}
  - Daily target range: ${metrics.targetRange} tickets/agent

Response quality:
  - Perfect / no edits: ${metrics.perfectPct}
  - Majority edit required: ${metrics.majorityPct}
  - Partial edit required: ${metrics.partialPct}
  - No response generated: ${metrics.noRespPct}

Top agents by volume:
${agentTable}

Category performance:
${catTable}

OUTPUT FORMAT
-------------
Write the report in clean markdown. Use ## for section headers and ** for emphasis. No unnecessary preamble — start directly with the first section.

Sections to include (adapt weight and depth based on audience and focus area):

## Summary
Two to three sentences capturing the headline story for this period.

## Key Metrics
Present the most relevant numbers clearly. Use a table if it aids readability.

## Performance Highlights
What went well. Be specific and reference actual data points.

## Areas for Attention
What needs focus. Be direct — name specific agents, categories, or metrics where relevant.

## Recommendations
Three to four concrete, prioritised actions. Each recommendation should be actionable within the next 7–14 days.

Rules:
- Every claim must be grounded in the data provided
- Do not invent metrics not present in the raw data
- Do not use filler phrases like "it is worth noting" or "in conclusion"
- Keep the total length proportionate to the audience: concise for executives, detailed for operations`
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured in Supabase secrets' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body: ReportRequest = await req.json()

    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 1500,
      messages:   [{ role: 'user', content: buildPrompt(body) }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''

    return new Response(
      JSON.stringify({ report: text }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
