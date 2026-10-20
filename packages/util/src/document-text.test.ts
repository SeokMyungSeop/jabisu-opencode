import { describe, expect, test } from "bun:test"
import { CFB } from "xlsx"
import { DocumentText } from "./document-text.js"

// A compound file or ZIP archive holding the named entries, written by SheetJS.
function container(fileType: "cfb" | "zip", entries: Record<string, string>) {
  const file = CFB.utils.cfb_new()
  for (const [name, content] of Object.entries(entries))
    CFB.utils.cfb_add(file, name, new TextEncoder().encode(content))
  const bytes: Uint8Array = CFB.write(file, { type: "array", fileType })
  return Uint8Array.from(bytes)
}

describe("DocumentText.sniff", () => {
  test.each([
    ["hwp", container("cfb", { "/FileHeader": "HWP Document File", "/BodyText/Section0": "" })],
    ["doc", container("cfb", { "/WordDocument": "x", "/1Table": "x" })],
    ["ppt", container("cfb", { "/PowerPoint Document": "x", "/Current User": "x" })],
    ["sheet", container("cfb", { "/Workbook": "x" })],
    ["hwpx", container("zip", { mimetype: "application/hwp+zip", "Contents/section0.xml": "<hs:sec/>" })],
    ["docx", container("zip", { "word/document.xml": "<w:document/>" })],
    ["pptx", container("zip", { "ppt/presentation.xml": "<p:presentation/>" })],
    ["sheet", container("zip", { "xl/workbook.xml": "<workbook/>" })],
  ] as const)("recognizes %s from its contents", async (format, bytes) => {
    expect(await DocumentText.sniff(bytes)).toBe(format)
  })

  test("leaves other files unrecognized", async () => {
    expect(await DocumentText.sniff(new TextEncoder().encode("plain text"))).toBeUndefined()
    expect(await DocumentText.sniff(container("zip", { "a.txt": "a" }))).toBeUndefined()
  })

  test("reports an encrypted Office file", async () => {
    await expect(DocumentText.sniff(container("cfb", { "/EncryptedPackage": "x" }))).rejects.toThrow(
      "it is password-protected (encrypted)",
    )
  })
})

describe("DocumentText.detect", () => {
  const hwp = container("cfb", { "/FileHeader": "HWP Document File" })
  const zip = container("zip", { "word/document.xml": "<w:document/>" })

  test("takes the format from the extension when the bytes are its container", () => {
    expect(DocumentText.detect("C:\\문서\\공문.HWP", hwp)).toBe("hwp")
    expect(DocumentText.detect("/docs/report.docx", zip)).toBe("docx")
    // An encrypted .docx is a compound file, which text() reports as protected.
    expect(DocumentText.detect("report.docx", hwp)).toBe("docx")
  })

  test("leaves other names and mismatched containers to the caller", () => {
    expect(DocumentText.detect("archive.zip", zip)).toBeUndefined()
    expect(DocumentText.detect("doc", hwp)).toBeUndefined()
    expect(DocumentText.detect("notes.hwp", new TextEncoder().encode("text"))).toBeUndefined()
    expect(DocumentText.detect("old.doc", zip)).toBeUndefined()
  })
})
