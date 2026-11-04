// Static "how this works" reference. Copy is the roadmap owner's, carried over
// as written except the open question about merging into Command Center,
// which this page now answers.
export default function About({ open, onToggle }: { open: boolean; onToggle: (o: boolean) => void }) {
  return (
    <details className="rm-about" id="rm-about" open={open} onToggle={e => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>How this dashboard works</summary>
      <div className="rm-about-grid">
        <div className="rm-def"><h4>Status rules</h4><dl>
          <dt><span className="rm-st rm-st-on">On track</span></dt><dd>Target date ahead, and issues closed are keeping pace with time elapsed.</dd>
          <dt><span className="rm-st rm-st-risk">At risk</span></dt><dd>Under 60% of issues closed with two weeks or less to target, more than 30 points behind the time elapsed, or any issue Blocked External.</dd>
          <dt><span className="rm-st rm-st-off">Off track</span></dt><dd>Target date has passed, the project is still open, and work is still happening on it.</dd>
          <dt><span className="rm-st rm-st-nodate">No target date</span></dt><dd>In progress with no target in Linear, so on track can't be judged.</dd>
          <dt><span className="rm-st rm-st-stale">Stale in Linear</span></dt><dd>Target passed with no work this quarter. Close it or re-date it.</dd>
          <dt><span className="rm-st rm-st-close">Ready to close</span></dt><dd>Every issue is done but the project is still open.</dd>
          <dt>Pieces of work</dt><dd>Each bar on the Roadmap groups several Linear projects under a plain-language name. Its status is the worst status among its dated projects. Names, descriptions and which projects belong where are kept here and can be changed in Edit.</dd>
        </dl></div>
        <div className="rm-def"><h4>Where the data comes from</h4><dl>
          <dt>Roadmap</dt><dd>One row per goal initiative in Linear, with sub-initiatives indented under it. Projects not yet under a goal initiative are grouped into the dashboard's own pieces of work until the team moves them. Quarter initiatives like "2026 Q4" set the time window, not a row. Milestones with dates show as diamonds.</dd>
          <dt>Tracks</dt><dd>The project's T1 to T5 label. A faded or striped colour means there's no label yet, so the track is suggested.</dd>
          <dt>Sprint</dt><dd>The current Linear cycle: its dates and how many of its issues are done.</dd>
          <dt>Keeping the lights on</dt><dd>Open issues labelled Bug or Tech Debt, so one-off fixes don't need a bucket project.</dd>
          <dt>Team</dt><dd>Whoever is assigned the project's issues, or the project lead: PixieLabs by email domain, Everyday AI for Alexander Gould's work, Raphie team for everyone else. Can be corrected in Edit.</dd>
          <dt>Goal links</dt><dd>Set on each piece of work, because Linear has no field for them. The first links were suggested and need checking.</dd>
          <dt>Key results</dt><dd>Status set by hand. Copied from the Miro Q4 board on 14 Sep.</dd>
          <dt>Issue stages</dt><dd>To do: Triage, Backlog, Spec required, Ready to start. In progress: In Progress, In Code Review, Changes requested, Ready to merge, Ready for Sign Off, Signed off. Blocked: Blocked External. Done: Deployed, Done. Canceled and Duplicate are left out.</dd>
          <dt>Future Focus</dt><dd>Ideas and parked items from the Miro board and ELT proposals, plus unstarted Q4 projects in Linear. RICE scores are kept here.</dd>
          <dt>Current focus</dt><dd>From Linear activity. The Spinach sprint-planning summary will be used when one is recorded.</dd>
        </dl></div>
        <div className="rm-def"><h4>Open questions for the ELT</h4><ol>
          <li>Do the pieces of work on the Roadmap read clearly to the whole team, and are they split the right way?</li>
          <li>Is a Done column enough context for completed work?</li>
          <li>Are the on-track rules above the right ones?</li>
          <li>Who owns OKRs and KRs, and should edits happen here, in the strategy on a page, or in the OKR tracker?</li>
          <li>Customer stages under the revenue KRs still come from the Miro board. What should replace them?</li>
          <li>Is the failed-sync banner the right behaviour when Linear can't be read?</li>
          <li>Does Jazz want this view, or a different level of detail?</li>
        </ol></div>
      </div>
    </details>
  )
}
