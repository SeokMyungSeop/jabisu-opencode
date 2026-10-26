import { onCleanup } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useExtension } from "../sdk"
import type definition from "./index"

export type Answer = "keep" | "reset" | undefined

/** Asks, after an update changed bundled skills the user copied, whether to keep the copies or use the new ones. */
export function ChangedSkills(props: { names: readonly string[]; backups: string; onAnswer: (answer: Answer) => void }) {
  const ctx = useExtension<typeof definition>()

  // Closing the dialog any other way is "later": nothing changes and the question comes back next start.
  onCleanup(() => props.onAnswer(undefined))

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={ctx.t("prompt.title")}
          description={ctx.t("prompt.description", { names: props.names.join(", ") })}
        />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-2 px-6 pb-2 text-13-regular text-text-base">
        <p>{ctx.t("prompt.keep")}</p>
        <p>{ctx.t("prompt.reset", { backups: props.backups })}</p>
        <p class="text-text-weak">{ctx.t("prompt.settings")}</p>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => props.onAnswer(undefined)}>
          {ctx.t("prompt.later")}
        </Button>
        <Button type="button" variant="neutral" onClick={() => props.onAnswer("reset")}>
          {ctx.t("prompt.useNew")}
        </Button>
        <Button type="button" variant="contrast" autofocus onClick={() => props.onAnswer("keep")}>
          {ctx.t("prompt.keepAll")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
