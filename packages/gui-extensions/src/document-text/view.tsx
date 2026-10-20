import { createSignal, onCleanup, Show } from "solid-js"
import { Loader } from "@opencode/ui/loader"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Markdown } from "@opencode/session-ui/markdown"
import { DocumentText } from "@opencode/util/document-text"
import type { FileViewerProps } from "../file/contract"
import { createKeyed, useExtension } from "../sdk"
import { previewMarkdown } from "./preview"

/**
 * Shows a document as the text the read tool gives the model: one converter serves both, so the preview is what the
 * model reads. Paragraphs, headings, lists and tables show; layout, fonts and images do not.
 */
export default function DocumentTextView(props: FileViewerProps) {
  const ctx = useExtension()
  const [text, setText] = createSignal<string>()

  createKeyed(
    () => props.bytes,
    (bytes) => {
      const controller = new AbortController()

      onCleanup(() => {
        controller.abort()
        setText(undefined)
      })

      void DocumentText.sniff(bytes)
        .then(async (format) => {
          if (format === undefined) throw new DocumentText.Unreadable(ctx.t("problem.format"))
          const converted = await DocumentText.text(format, bytes)

          if (controller.signal.aborted) return
          setText(previewMarkdown(converted))
          props.onDetails([ctx.t(`format.${format}`), ctx.t("textOnly")])
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          props.onError(error instanceof DocumentText.Unreadable ? error.message : undefined)
        })
    },
  )

  return (
    <Show
      when={text() !== undefined}
      fallback={
        <div class="flex min-h-0 flex-1 items-center justify-center">
          <Loader />
        </div>
      }
    >
      <ScrollView class="min-h-0 flex-1">
        <div class="mx-auto w-full max-w-3xl px-8 py-6">
          <Show when={text()} fallback={<div class="text-13-regular text-text-weak">{ctx.t("empty")}</div>}>
            {(value) => <Markdown text={value()} />}
          </Show>
        </div>
      </ScrollView>
    </Show>
  )
}
