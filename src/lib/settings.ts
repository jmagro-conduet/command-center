export const TARGET_MIN_KEY = 'cc_target_min'
export const TARGET_MAX_KEY = 'cc_target_max'

export function getDailyTarget(): { min: number; max: number } {
  return {
    min: parseInt(localStorage.getItem(TARGET_MIN_KEY) ?? '20', 10),
    max: parseInt(localStorage.getItem(TARGET_MAX_KEY) ?? '30', 10),
  }
}
