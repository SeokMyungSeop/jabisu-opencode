/** The file's name, or the first `name (n).ext` that is not taken. */
export function freeName(name: string, taken: ReadonlySet<string>) {
  if (!taken.has(name)) return name

  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ""
  const numbered = (count: number) => `${stem} (${count})${extension}`

  const count = Array.from({ length: taken.size + 1 }, (_, index) => index + 2).find(
    (candidate) => !taken.has(numbered(candidate)),
  )

  return numbered(count ?? taken.size + 2)
}
