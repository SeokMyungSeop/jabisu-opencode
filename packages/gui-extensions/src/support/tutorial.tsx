import { createResource, For, onCleanup, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { builtin, locationOf } from "../builtin-server"
import { useExtension } from "../sdk"
import type definition from "./index"

// The work status changes while the user does a mission in another tab, so it is read again this often.
const REFRESH_MS = 5_000

type Mission = "folders" | "profile" | "search" | "docs" | "law"

/**
 * The home screen's 따라하기: the first things to do, each with a button that opens the place to do it. A mission is
 * done when its result exists (chosen folders, a work profile) or, for one that leaves none, once tried; asking about
 * a law needs the 법제처 key first, so until it is saved that mission opens the settings.
 */
export default function HomeTutorial(props: { guide: () => void }) {
  const ctx = useExtension<typeof definition>()
  const store = ctx.stores.tutorial

  const [work, { refetch }] = createResource(
    () => builtin(ctx.servers),
    (current) => current.client.jabisu.work.get({ location: locationOf(current) }).catch(() => undefined),
  )

  const [law, { refetch: refetchLaw }] = createResource(
    () => builtin(ctx.servers),
    (current) => current.client.jabisu.law.get({ location: locationOf(current) }).catch(() => undefined),
  )

  const timer = setInterval(() => {
    void refetch()
    void refetchLaw()
  }, REFRESH_MS)

  onCleanup(() => clearInterval(timer))

  const done = (mission: Mission) => {
    const current = work.latest

    if (mission === "folders") return !!current && current.received.length + current.saved.length > 0

    if (mission === "profile") return !!current?.profile.exists

    if (mission === "law" && !law.latest?.configured) return false

    return store.value.tried.includes(mission)
  }

  // A mission done in a chat starts in 자비수's own work folder, where writing the profile needs no permission.
  const chat = (mission: Mission) => {
    const current = builtin(ctx.servers)
    const directory = work.latest?.jabisu.path

    if (!current || !directory) return
    store.update((draft) => {
      if (!draft.tried.includes(mission)) draft.tried.push(mission)
    })
    ctx.layout.draft(current.id, directory, ctx.t(`mission.${mission}.prompt`))
  }

  // Until the key is saved, the law mission says so and opens the settings where it goes.
  const setup = (mission: Mission) => mission === "law" && !law.latest?.configured
  const text = (mission: Mission, part: "description" | "action") =>
    ctx.t(setup(mission) ? `mission.${mission}.setup.${part}` : `mission.${mission}.${part}`)

  const missions: readonly { id: Mission; run: () => void }[] = [
    { id: "folders", run: () => ctx.layout.settings("general") },
    { id: "profile", run: () => chat("profile") },
    { id: "search", run: () => chat("search") },
    { id: "docs", run: () => chat("docs") },
    { id: "law", run: () => (setup("law") ? ctx.layout.settings("general") : chat("law")) },
  ]

  const finished = () => missions.filter((mission) => done(mission.id)).length

  return (
    <Show when={!store.value.hidden && work.latest}>
      <section class="mx-1.5 mb-2 flex min-w-0 shrink-0 flex-col gap-2 rounded-[8px] border border-v2-border-border-base p-2.5">
        <div class="flex min-w-0 items-center justify-between gap-2">
          <span class="truncate text-v2-text-text-base [font-weight:530]">{ctx.t("tutorial.title")}</span>
          <span class="shrink-0 text-12-regular tabular-nums text-v2-text-text-faint">
            {finished()}/{missions.length}
          </span>
        </div>
        <Show
          when={finished() < missions.length}
          fallback={<p class="text-12-regular text-v2-text-text-muted">{ctx.t("tutorial.done")}</p>}
        >
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("tutorial.intro")}</p>
        </Show>
        <ol class="flex flex-col gap-2">
          <For each={missions}>
            {(mission, index) => (
              <li class="flex min-w-0 items-start gap-2">
                <Show
                  when={done(mission.id)}
                  fallback={
                    <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-v2-border-border-base text-11-regular text-v2-text-text-muted">
                      {index() + 1}
                    </span>
                  }
                >
                  <Icon name="circle-check" size="small" class="mt-0.5 shrink-0 text-v2-state-fg-success" />
                </Show>
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    class="text-13-regular"
                    classList={{
                      "text-v2-text-text-base": !done(mission.id),
                      "text-v2-text-text-faint line-through": done(mission.id),
                    }}
                  >
                    {ctx.t(`mission.${mission.id}.title`)}
                  </span>
                  <Show when={!done(mission.id)}>
                    <span class="text-12-regular text-v2-text-text-muted">{text(mission.id, "description")}</span>
                    <Button type="button" size="small" variant="neutral" class="self-start" onClick={mission.run}>
                      {text(mission.id, "action")}
                    </Button>
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ol>
        <div class="flex items-center justify-between">
          <Button type="button" size="small" variant="ghost" onClick={props.guide}>
            {ctx.t("tutorial.guide")}
          </Button>
          <Button
            type="button"
            size="small"
            variant="ghost"
            onClick={() =>
              store.update((draft) => {
                draft.hidden = true
              })
            }
          >
            {ctx.t("tutorial.hide")}
          </Button>
        </div>
      </section>
    </Show>
  )
}
