// What the planned pages will show. Edit this file to update the plan page and the Home card:
// nothing else needs to change. Keep owner and target honest: "To be confirmed" until they are.
export interface PlannedPage {
  summary: string
  willShow: string[]
  source: string
  owner: string
  target: string
}

export const PLANNED: Record<string, PlannedPage> = {
  'customer-success': {
    summary: "One table of every client with its stage, mode and next step, so the ELT can see where each account stands without asking around.",
    willShow: [
      "Each client's stage: live, converting a POC, POC planned or paused",
      'Mode: CoPilot or Full Auto',
      'Tickets and perfect rate for the last 30 days',
      'The agreed next step and who owns it',
    ],
    source: 'Operator data already in Raphie Hub. Stage and next step need an owner to keep them current.',
    owner: 'To be confirmed',
    target: 'To be confirmed',
  },
  'client-status': {
    summary: 'Where each client is in its journey, with the sales funnel behind it.',
    willShow: [
      'Clients and prospects by stage, from first conversation to live',
      'Pipeline value and movement by stage',
      'What is blocking each deal, and the next step',
    ],
    source: 'To be confirmed (the CRM or pipeline tool).',
    owner: 'To be confirmed',
    target: 'To be confirmed',
  },
}
