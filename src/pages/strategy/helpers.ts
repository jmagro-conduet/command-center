import { WriteError } from '../../lib/strategy/useStrategy'

// A failed write -> a message for the toast.
export function saveErr(e: unknown, fallback = "Couldn't save. Try again."): string {
  return e instanceof WriteError && e.denied ? 'You have view-only access to Strategy.' : fallback
}
