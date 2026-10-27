export * as ReadDocument from "./read-document.js"

import { DocumentText } from "@opencode/util/document-text"

// Office documents convert through `DocumentText`, which the app's file preview shares. Hangul documents read through
// kordoc, and PDF text stays here: only the read tool and 집현전 search need them.

export type Format = DocumentText.Format | "pdf"

export const LABELS = { ...DocumentText.LABELS, pdf: "PDF" } satisfies Record<Format, string>

/** A document's text, and the PDF pages (from 1) with none, which are probably scanned images and cannot be searched. */
export interface Converted {
  readonly text: string
  readonly blank: readonly number[]
}

// Text a reader can search has a letter, or numbers such as a table's; a page number alone is not enough.
const readable = (text: string) => /\p{L}/u.test(text) || (text.match(/\p{N}/gu)?.length ?? 0) >= 4

export async function convert(format: Format, bytes: Uint8Array): Promise<Converted> {
  if (format === "pdf") return pdf(bytes)
  const text =
    format === "hwp" || format === "hwpx" ? await hangul(format, bytes) : await DocumentText.text(format, bytes)

  // A document made only of pictures, such as scans pasted into a Hangul file, has nothing to read.
  if (!readable(text))
    throw new DocumentText.Unreadable(
      "it has no text: it is empty or only pictures such as scans; a model that accepts image input can read those",
    )

  return { text, blank: [] }
}

export const text = (format: Format, bytes: Uint8Array) => convert(format, bytes).then((converted) => converted.text)

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

/** Each page's text, and the pages without any. */
async function pdf(bytes: Uint8Array): Promise<Converted> {
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
  if (!pages.some(readable))
    throw new DocumentText.Unreadable(
      "it has no text layer, so it is probably scanned images; a model that accepts PDF or image input can read it",
    )
  return {
    text: pages
      .map(
        (page, index) =>
          `## Page ${index + 1}\n${readable(page) ? page : "(no text on this page; it may be a scanned image)"}`,
      )
      .join("\n\n"),
    blank: pages.flatMap((page, index) => (readable(page) ? [] : [index + 1])),
  }
}
