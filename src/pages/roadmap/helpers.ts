import type { Proj, Quarter } from '../../lib/roadmap/logic'
import { doneThisQ } from '../../lib/roadmap/logic'
import type { Ctx } from './ui'

export const saveErr = (e: any, fallback = "Couldn't save. Try again.") =>
  e && e.code === 'invalid_argument' ? "You don't have edit access to this roadmap." : fallback

export const boardProjects = (P: Proj[], q: Quarter): Proj[] =>
  P.filter(p => p.status === 'canceled' ? (p.track === 'ops' && p.trackFrom === 'linear') : (p.status !== 'done' || doneThisQ(p, q)))

// Today as YYYY-MM-DD in the viewer's timezone (what an <input type="date"> expects)
export const todayLocalISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

export async function newsWrite(ctx: Ctx, id: string, patch: Record<string, any>, msg?: string) {
  try { await ctx.writer.update('news', id, { ...patch, updatedAt: new Date().toISOString() }); if (msg) ctx.toast(msg) }
  catch { ctx.toast("Couldn't save. Try again.") }
}
