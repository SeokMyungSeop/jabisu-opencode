import { describe, expect, test } from "bun:test"
import { inlineCodeKind, isDocumentPath } from "./markdown-inline-code-kind"

describe("inlineCodeKind", () => {
  test.each([
    "app.tsx",
    "app.tsx:42",
    "app.tsx#L42-L55",
    "src/file.ts",
    "C:\\tmp\\out.html",
    "/etc/hosts",
    "app/(auth)/[id]/page.tsx",
    "console.log",
    "Dockerfile",
    "Makefile:12",
  ])("treats %s as a possible path", (text) => {
    expect(inlineCodeKind(text)).toBe("path")
  })

  test.each([
    "value",
    "readme",
    "1.2.3",
    "127.0.0.1:8080",
    "foo(bar)",
    "a = b",
    "<App />",
    "src/**/*.ts",
    "{ a: 1 }",
    "...",
    "ftp://x/y",
    "\\\\host\\share\\x.ts",
    "//host/share/x.ts",
  ])("leaves %s as code", (text) => {
    expect(inlineCodeKind(text)).toBeUndefined()
  })

  test("detects http urls", () => {
    expect(inlineCodeKind("https://opencode.ai/docs")).toBe("url")
  })
})

describe("isDocumentPath", () => {
  test("names the documents 자비수 makes, whatever the folder or the case", () => {
    for (const path of ["보고서.hwpx", "out/계획.DOCX", "C:/work/예산.xlsx", "발표.pptx:1", "옛.hwp"])
      expect(isDocumentPath(path)).toBe(true)
  })

  test("leaves other files and bare extensions alone", () => {
    for (const path of ["notes.md", "report.pdf", "data.csv", ".hwpx", "hwpx", "make_docx.py", ""])
      expect(isDocumentPath(path)).toBe(false)
  })
})
