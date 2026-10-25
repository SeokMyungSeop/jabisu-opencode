import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createSync, type Listed } from "./state"

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test("reloads every view and tells the last view of a 집현전 when files arrive from outside the app", async () => {
  let items: Listed[] = [{ name: "a", sources: ["one.pdf"] }]
  const heard: string[] = []

  await createRoot(async (dispose) => {
    const sync = createSync(async () => items)
    const stop = sync.watch()

    sync.arrived(
      () => "a",
      () => heard.push("panel"),
    )
    sync.arrived(
      () => "a",
      () => heard.push("window"),
    )
    await settle()
    const before = sync.revision()

    items = [{ name: "a", sources: ["one.pdf", "two.hwpx"] }]
    window.dispatchEvent(new Event("focus"))
    await settle()
    expect(sync.revision()).toBe(before + 1)
    expect(heard).toEqual(["window"])

    // A removed file reloads the views, and a new 집현전 is not an arrival.
    items = [
      { name: "a", sources: ["two.hwpx"] },
      { name: "b", sources: ["three.docx"] },
    ]
    window.dispatchEvent(new Event("focus"))
    await settle()
    expect(sync.revision()).toBe(before + 2)
    expect(heard).toEqual(["window"])

    stop()
    dispose()
  })
})

test("takes the app's own changes as the new baseline without reporting them", async () => {
  let items: Listed[] = [{ name: "a", sources: [] }]
  const heard: string[] = []

  await createRoot(async (dispose) => {
    const sync = createSync(async () => items)
    const stop = sync.watch()

    sync.arrived(
      () => "a",
      () => heard.push("a"),
    )
    await settle()

    items = [{ name: "a", sources: ["added in the app.pdf"] }]
    sync.changed()
    await settle()
    const after = sync.revision()

    window.dispatchEvent(new Event("focus"))
    await settle()
    expect(sync.revision()).toBe(after)
    expect(heard).toEqual([])

    stop()
    dispose()
  })
})
