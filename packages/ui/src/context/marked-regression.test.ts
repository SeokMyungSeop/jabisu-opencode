import { expect, test } from "bun:test"
import { Marked } from "marked"

test("preserves code spans adjacent to tildes", async () => {
  const marked = new Marked()

  expect(await marked.parse("~`0.1576` to measurement-window-only `0.00092`")).toBe(
    "<p>~<code>0.1576</code> to measurement-window-only <code>0.00092</code></p>\n",
  )
  expect(await marked.parse("`before`~`after`")).toBe("<p><code>before</code>~<code>after</code></p>\n")
  expect(await marked.parse("~~`deleted code`~~")).toBe("<p><del><code>deleted code</code></del></p>\n")
})

test("reads single tildes as Korean ranges and strikes only ~~double~~ tildes", async () => {
  const { createMarkdownBase, parseSmallMarkdown } = await import("./marked-base")
  const marked = createMarkdownBase()
  const ranges = "행정부 안은 국무총리와 국무위원(제86조~제87조), 국무회의(제88조~제93조)로 나뉘어요."

  for (const html of [await marked.parse(ranges), parseSmallMarkdown(ranges) ?? ""]) {
    expect(html).not.toContain("<del>")
    expect(html).toContain("제86조~제87조")
    expect(html).toContain("제88조~제93조")
  }
  expect(await marked.parse("~~지운 말~~과 남는 말")).toBe("<p><del>지운 말</del>과 남는 말</p>\n")
  expect(await marked.parse("~~`deleted code`~~")).toBe("<p><del><code>deleted code</code></del></p>\n")
  expect(await marked.parse("값은 1~3, 범위는 ~~틀린 값~~ 4~6")).toBe("<p>값은 1~3, 범위는 <del>틀린 값</del> 4~6</p>\n")
})
