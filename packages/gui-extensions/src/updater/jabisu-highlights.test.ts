import { describe, expect, test } from "bun:test"
import { highlightsSince, JABISU_HIGHLIGHTS } from "./jabisu-highlights"

const item = (title: string) => ({ title, description: title })
const LIST = [
  { version: "1.6.0", items: [item("a"), item("b")] },
  { version: "1.5.10", items: [item("c")] },
  { version: "1.5.9", items: [item("d")] },
]

describe("자비수 highlights after an update", () => {
  test("shows the releases after the one last seen, up to the running one", () => {
    expect(highlightsSince("1.5.8", "1.5.10", LIST).map((x) => x.title)).toEqual(["c", "d"])
    expect(highlightsSince("1.5.9", "1.6.0", LIST).map((x) => x.title)).toEqual(["a", "b", "c"])
  })

  test("compares versions by number, so 1.5.10 comes after 1.5.9", () => {
    expect(highlightsSince("1.5.9", "1.5.10", LIST).map((x) => x.title)).toEqual(["c"])
  })

  test("shows nothing for the same version, a downgrade, or a version it cannot read", () => {
    expect(highlightsSince("1.5.10", "1.5.10", LIST)).toEqual([])
    expect(highlightsSince("1.6.0", "1.5.9", LIST)).toEqual([])
    expect(highlightsSince("local", "1.6.0", LIST)).toEqual([])
  })

  test("keeps at most five pages", () => {
    const many = [{ version: "2.0.0", items: ["1", "2", "3", "4", "5", "6", "7"].map(item) }]

    expect(highlightsSince("1.0.0", "2.0.0", many)).toHaveLength(5)
  })

  test("every shipped release has a title and a description on each page", () => {
    for (const release of JABISU_HIGHLIGHTS)
      for (const page of release.items) expect(page.title && page.description).toBeTruthy()
  })
})
