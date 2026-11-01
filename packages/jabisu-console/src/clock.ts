// Days and months as people in Korea count them: limits reset at midnight Korea time.
const KST = 9 * 3_600_000
const DAY = 86_400_000

/** The Korean calendar day of a time, as 2026-11-01. */
export const day = (time: number) => new Date(time + KST).toISOString().slice(0, 10)

/** The Korean calendar month of a time, as 2026-11. */
export const month = (time: number) => day(time).slice(0, 7)

/** The next midnight in Korea after a time. */
export const midnight = (time: number) => (Math.floor((time + KST) / DAY) + 1) * DAY - KST

/** Whole days from one calendar day to another. */
export const between = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY)
