import type { WorkDatabase } from "./database-types.js"

/** Runtimes without Bun's SQLite have no work index; 자비수 itself always runs on Bun. */
export function openWorkDatabase(
  _filename: string,
  _options: { readonly readonly?: boolean } = {},
): WorkDatabase | undefined {
  return undefined
}
