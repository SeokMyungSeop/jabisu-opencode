import { createResource, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useExtension } from "../sdk"
import type definition from "./index"
import { builtin, locationOf, type Sync } from "./state"

const ROW =
  "flex h-7 min-w-0 w-full items-center gap-2 rounded-[6px] px-1.5 text-left text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base"

/** The home screen's 집현전 list, above the projects; each opens the 집현전 window on it. */
export default function HomeSection(props: { sync: Sync; open: (input: { name?: string; create?: boolean }) => void }) {
  const ctx = useExtension<typeof definition>()

  const [list] = createResource(
    () => {
      const current = builtin(ctx.servers)

      return current ? { current, revision: props.sync.revision() } : undefined
    },
    ({ current }) => current.client.jabisu.jiphyeonjeon.list({ location: locationOf(current) }),
  )

  return (
    <section class="flex min-w-0 shrink-0 flex-col gap-1">
      <div class="flex h-7 min-w-0 items-center justify-between pl-1.5 pr-3">
        <div class="text-v2-text-text-muted [font-weight:530]">{ctx.t("title")}</div>
        <IconButton
          variant="ghost-muted"
          size="large"
          icon={<Icon name="plus" />}
          aria-label={ctx.t("create.open")}
          onClick={() => props.open({ create: true })}
        />
      </div>
      <Show
        when={list.latest?.items.length}
        fallback={
          <button type="button" class={ROW} onClick={() => props.open({ create: true })}>
            <Icon name="archive" size="small" />
            <span class="truncate">{ctx.t("home.empty")}</span>
          </button>
        }
      >
        <For each={list.latest?.items}>
          {(item) => (
            <button type="button" class={ROW} onClick={() => props.open({ name: item.name })}>
              <Icon name="archive" size="small" />
              <span class="min-w-0 flex-1 truncate">{item.name}</span>
              <span class="shrink-0 pr-1.5 text-12-regular text-v2-text-text-faint">
                {ctx.t("sources.count", { count: item.sources.length })}
              </span>
            </button>
          )}
        </For>
      </Show>
    </section>
  )
}
