import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import type { JabisuSkill } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@opencode/ui/toast"
import { useExtension } from "../sdk"
import type { ContextUsageProps } from "./contract"
import type definition from "./index"

type Group = "mine" | "bundled" | "other"

const GROUPS: readonly Group[] = ["mine", "bundled", "other"]

const BADGE: Record<JabisuSkill["status"] | "off", string> = {
  default: "bg-v2-background-bg-layer-04 text-v2-text-text-muted",
  custom: "bg-v2-state-bg-success text-v2-state-fg-success",
  changed: "bg-v2-state-bg-warning text-v2-state-fg-warning",
  off: "bg-v2-background-bg-layer-04 text-v2-text-text-faint",
}

// Windows compares paths without case and with either separator.
const key = (file: string) => file.replaceAll("\\", "/").toLowerCase()

/**
 * Every skill the session can use, grouped by where it comes from: the user's own, the ones 자비수 bundles (with
 * their Korean names, whether they are on, and whether the user's copy replaces them), and the rest; searchable in
 * Korean by name, description and search words.
 */
export function SkillList(props: ContextUsageProps & { tokens?: string }) {
  const ctx = useExtension<typeof definition>()
  const [query, setQuery] = createSignal("")
  const [busy, setBusy] = createSignal<string>()
  const data = () => props.session.server.data
  const location = () => ({ directory: props.session.directory })

  // The session's skills may not be loaded yet; 자비수 says which are bundled and where the user's own live.
  const [bundled, { mutate }] = createResource(
    () => ({ data: data(), client: props.session.server.client, directory: props.session.directory }),
    async (input) => {
      await input.data.location.skill.sync({ directory: input.directory })

      return input.client.jabisu.skills.list({ location: { directory: input.directory } }).catch(() => undefined)
    },
  )

  const all = createMemo(() => {
    const list = bundled.latest
    const named = new Map((list?.skills ?? []).map((skill) => [skill.name, skill]))
    const folder = list ? `${key(list.folder)}/` : undefined

    return (data().location.skill.list({ directory: props.session.directory }) ?? [])
      .map((skill) => {
        const known = named.get(skill.name)
        const group: Group = known ? "bundled" : folder && key(skill.path).startsWith(folder) ? "mine" : "other"

        return {
          name: skill.name,
          title: known?.title,
          // 자비수's Korean summary for its own skills, the skill's own description otherwise.
          text: known?.summary ?? skill.description ?? "",
          search: [skill.name, skill.description, known?.title, known?.summary, ...(known?.keywords ?? [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          path: skill.path,
          group,
          known,
        }
      })
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })

  const shown = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean)

    return all().filter((skill) => words.every((word) => skill.search.includes(word)))
  })

  const turn = async (name: string, on: boolean) => {
    setBusy(name)

    try {
      mutate(await props.session.server.client.jabisu.skills.turn({ location: location(), name, on }))
    } catch (error) {
      showToast({
        variant: "error",
        title: ctx.t("skills.turnFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitleGroup
          title={ctx.t("skills.title", { count: all().length })}
          description={ctx.t("skills.description")}
        />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-col gap-3 px-6 pb-6">
        <Show when={props.tokens}>
          {(tokens) => <p class="text-12-regular text-text-weak">{ctx.t("skills.context", { tokens: tokens() })}</p>}
        </Show>
        <TextField
          label={ctx.t("skills.search")}
          hideLabel
          autofocus
          placeholder={ctx.t("skills.search")}
          value={query()}
          onChange={setQuery}
        />
        <Show
          when={!bundled.loading || all().length}
          fallback={<p class="text-13-regular text-text-weak">{ctx.t("skills.loading")}</p>}
        >
          <Show when={shown().length} fallback={<p class="text-13-regular text-text-weak">{ctx.t("skills.empty")}</p>}>
            <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
              <For each={GROUPS.filter((group) => shown().some((skill) => skill.group === group))}>
                {(group) => (
                  <section class="flex flex-col gap-1">
                    <h4 class="text-12-medium text-text-weak">
                      {ctx.t(`skills.group.${group}`)} · {shown().filter((skill) => skill.group === group).length}
                    </h4>
                    <For each={shown().filter((skill) => skill.group === group)}>
                      {(skill) => (
                        <div class="flex min-w-0 items-center gap-2 rounded-[6px] px-2 py-1.5 hover:bg-surface-raised-base-hover">
                          <button
                            type="button"
                            class="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                            title={skill.path}
                            onClick={() => void ctx.desktop?.launch(skill.path)}
                          >
                            <span class="flex min-w-0 items-center gap-2">
                              <span class="truncate text-13-medium text-text-base">{skill.name}</span>
                              <Show when={skill.title}>
                                {(title) => <span class="truncate text-12-regular text-text-weak">{title()}</span>}
                              </Show>
                              <Show when={skill.known}>
                                {(known) => (
                                  <>
                                    <Show when={!known().on}>
                                      <span class={`shrink-0 rounded-[4px] px-1.5 text-11-regular ${BADGE.off}`}>
                                        {ctx.t("skills.off")}
                                      </span>
                                    </Show>
                                    <Show when={known().status !== "default"}>
                                      <span
                                        class={`shrink-0 rounded-[4px] px-1.5 text-11-regular ${BADGE[known().status]}`}
                                      >
                                        {ctx.t(`skills.status.${known().status}`)}
                                      </span>
                                    </Show>
                                  </>
                                )}
                              </Show>
                            </span>
                            <Show when={skill.text}>
                              <span class="line-clamp-2 text-12-regular text-text-weak">{skill.text}</span>
                            </Show>
                          </button>
                          <Show when={skill.known}>
                            {(known) => (
                              <Button
                                type="button"
                                size="small"
                                variant={known().on ? "ghost" : "neutral"}
                                disabled={busy() === known().name}
                                onClick={() => void turn(known().name, !known().on)}
                              >
                                {ctx.t(known().on ? "skills.turnOff" : "skills.turnOn")}
                              </Button>
                            )}
                          </Show>
                        </div>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
