export * as ReadDocument from "./read-document.js"

import { DocumentText } from "@opencode/util/document-text"

// Office documents convert through `DocumentText`, which the app's file preview shares. Hangul documents read through
// kordoc, and PDF text stays here: only the read tool and 집현전 search need them.

export type Format = DocumentText.Format | "pdf"

export const LABELS = { ...DocumentText.LABELS, pdf: "PDF" } satisfies Record<Format, string>

export function text(format: Format, bytes: Uint8Array) {
  if (format === "pdf") return pdf(bytes)
  if (format === "hwp" || format === "hwpx") return hangul(format, bytes)
  return DocumentText.text(format, bytes)
}

/**
 * A Hangul document through kordoc (MIT), which reads merged table cells, automatic numbering and headings as Hancom
 * lays them out; a table with merged cells comes out as HTML with its spans. A document kordoc cannot read falls back
 * to `DocumentText`, which also reports encrypted documents.
 */
async function hangul(format: "hwp" | "hwpx", bytes: Uint8Array) {
  // Its OCR and formula models are not shipped and would be downloaded, so both stay off.
  const result = await import("kordoc")
    .then(({ parse }) => parse(Buffer.from(bytes), { ocr: false, formulaOcr: false, plain: true }))
    .catch(() => undefined)
  if (result?.success && result.markdown.trim()) return result.markdown.trim()
  return DocumentText.text(format, bytes)
}

/** Each page's text. */
async function pdf(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf")
  // PDF.js detaches the buffer it is given, so it gets a copy. Verbosity 0 keeps its warnings about damaged
  // files off the console, which a terminal interface shares.
  const document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "PasswordException")
      throw new DocumentText.Unreadable("it is password-protected (encrypted)")
    throw error
  })
  const result = await extractText(document, { mergePages: false }).finally(() => document.loadingTask.destroy())
  const pages = result.text.map((page) => page.trim())
  if (pages.every((page) => page === ""))
    throw new DocumentText.Unreadable(
      "it has no text layer, so it is probably scanned images; a model that accepts PDF or image input can read it",
    )
  return pages
    .map((page, index) => `## Page ${index + 1}\n${page || "(no text on this page; it may be a scanned image)"}`)
    .join("\n\n")
}
