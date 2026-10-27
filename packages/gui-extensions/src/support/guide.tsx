import { For, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useExtension } from "../sdk"
import type definition from "./index"

/** The guide on the web, for reading outside the app. */
export const GUIDE = "https://github.com/SeokMyungSeop/jabisu-opencode#readme"

type Section = "start" | "work" | "documents" | "admin" | "law" | "jiphyeonjeon" | "skills" | "safety" | "more"

// Each section, and the settings page that does what it describes, if any.
const SECTIONS: readonly { id: Section; settings?: string }[] = [
  { id: "start", settings: "providers" },
  { id: "work", settings: "general" },
  { id: "documents" },
  { id: "admin" },
  { id: "law", settings: "general" },
  { id: "jiphyeonjeon" },
  { id: "skills", settings: "general" },
  { id: "safety" },
  { id: "more", settings: "general" },
]

/**
 * 자비수's guide for someone using it the first time, inside the app, since a work PC may not reach the web. Each
 * section says what a feature does, where it is and what to say, in lines taken from the extension's own strings.
 */
export function Guide() {
  const ctx = useExtension<typeof definition>()

  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("guide.title")} description={ctx.t("guide.intro")} />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-col gap-3 px-6 pb-6">
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-1">
          <For each={SECTIONS}>
            {(section) => (
              <section class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <h4 class="text-14-medium text-text-base">{ctx.t(`guide.${section.id}.title`)}</h4>
                  <Show when={section.settings}>
                    {(page) => (
                      <Button type="button" size="small" variant="ghost" onClick={() => ctx.layout.settings(page())}>
                        {ctx.t("guide.settings")}
                      </Button>
                    )}
                  </Show>
                </div>
                <ul class="flex list-disc flex-col gap-1 pl-5 text-13-regular text-text-base">
                  <For each={ctx.t(`guide.${section.id}.body`).split("\n")}>{(line) => <li>{line}</li>}</For>
                </ul>
              </section>
            )}
          </For>
        </div>
        <div class="flex justify-end">
          <Button type="button" size="small" variant="ghost" onClick={() => ctx.system.openExternal(GUIDE)}>
            {ctx.t("guide.web")}
          </Button>
        </div>
      </DialogBody>
    </Dialog>
  )
}
