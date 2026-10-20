import { expect, test } from "bun:test"
import { previewMarkdown } from "./preview"

test("keeps each converted line a paragraph of its own and table rows together", () => {
  expect(
    previewMarkdown(
      ["# 보고", "첫 문단", "둘째 문단", "| 항목 | 담당 |", "| --- | --- |", "| 예산 | 명상 |", "끝"].join("\n"),
    ),
  ).toBe(
    ["# 보고\n", "첫 문단\n", "둘째 문단\n", "| 항목 | 담당 |", "| --- | --- |", "| 예산 | 명상 |\n", "끝\n"].join(
      "\n",
    ),
  )
})

test("keeps leading indentation visible instead of making a code block, except for nested list items", () => {
  expect(previewMarkdown("\t들여쓴 줄\n    (체육과)\n  - 하위 항목")).toBe(
    [" ".repeat(4) + "들여쓴 줄\n", " ".repeat(4) + "(체육과)\n", "  - 하위 항목\n"].join("\n"),
  )
})
