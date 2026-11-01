import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Markdown } from "@opencode/session-ui/markdown"
import { useExtension } from "../sdk"
import type definition from "./index"

/** The latest instruction change the AI was told about, opened from the Context tab: long and mostly in English. */
export function SystemPrompt(props: { text: string }) {
  const ctx = useExtension<typeof definition>()

  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("systemPrompt.title")} description={ctx.t("systemPrompt.description")} />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-col px-6 pb-6">
        <div class="min-h-0 flex-1 overflow-auto rounded-md border border-border-base bg-surface-base px-3 py-2">
          <Markdown text={props.text} class="text-12-regular" />
        </div>
      </DialogBody>
    </Dialog>
  )
}
