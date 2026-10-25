import { onCleanup, Show } from "solid-js"
import type { Jiphyeonjeon } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useExtension, type MountedSession } from "../sdk"
import type definition from "./index"
import { Instructions, Sources, type Writer } from "./parts"
import type { Sync } from "./state"

/** A 집현전 chat's side panel: the sources it answers from, which open in the file view, and its instructions. */
export default function SourcesPanel(props: {
  item: Jiphyeonjeon
  writer: Writer | undefined
  sync: Sync
  session: MountedSession
}) {
  const ctx = useExtension<typeof definition>()

  onCleanup(props.sync.watch())

  return (
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-14-medium text-text-strong">{props.item.name}</span>
        <Show when={ctx.desktop}>
          {(desktop) => (
            <Button
              type="button"
              size="small"
              variant="ghost"
              onClick={() => void desktop().reveal(props.item.directory)}
            >
              {ctx.t("action.folder")}
            </Button>
          )}
        </Show>
      </div>
      <Sources
        item={props.item}
        writer={props.writer}
        sync={props.sync}
        onOpen={(path) => void ctx.links.open({ href: path, session: props.session, exact: true })}
      />
      <Instructions item={props.item} writer={props.writer} sync={props.sync} />
    </div>
  )
}
