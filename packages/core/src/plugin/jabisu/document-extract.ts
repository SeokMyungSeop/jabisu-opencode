export * as DocumentExtract from "./document-extract.js"

import { DocumentText } from "@opencode/util/document-text"
import { Effect, Result } from "effect"
import { Mime } from "../../mime.js"
import { ReadDocument } from "../../tool/read-document.js"

// The text 자비수 searches in a file: documents the read tool converts, and plain text files as they are. Both the
// 집현전 search and the work index read files through this one conversion.

/** A file's searchable text with the PDF pages (from 1) that have none, or why the file has no text. */
export type Extracted =
  | { readonly status: "ready"; readonly text: string; readonly blank: readonly number[] }
  | { readonly status: "unsupported" | "unreadable"; readonly reason: string }

/** The searchable text of a file's bytes; `file` names it, for its extension. */
export const fromBytes = Effect.fn("DocumentExtract.fromBytes")(function* (
  file: string,
  bytes: Uint8Array,
): Effect.fn.Return<Extracted> {
  const format = Mime.detect(bytes) === "application/pdf" ? "pdf" : DocumentText.detect(file, bytes)

  if (!format && bytes.includes(0)) return { status: "unsupported", reason: "not a document or text file" }
  const converted = format
    ? yield* Effect.tryPromise({
        try: () => ReadDocument.convert(format, bytes),
        catch: (cause) =>
          cause instanceof DocumentText.Unreadable
            ? cause.message
            : `the ${ReadDocument.LABELS[format]} could not be converted`,
      }).pipe(Effect.result)
    : Result.succeed<ReadDocument.Converted>({ text: new TextDecoder().decode(bytes), blank: [] })

  if (Result.isFailure(converted)) return { status: "unreadable", reason: converted.failure }

  return { status: "ready", text: converted.success.text, blank: converted.success.blank }
})
