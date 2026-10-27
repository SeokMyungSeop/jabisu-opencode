import { createResource, For, Show, type JSX } from "solid-js"
import type { JabisuSkill } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { useExtension } from "../sdk"
import type definition from "./index"
import { builtin, locationOf } from "../builtin-server"

const BADGE: Record<JabisuSkill["status"], string> = {
  default: "bg-v2-background-bg-layer-01 text-v2-text-text-muted",
  custom: "bg-v2-state-bg-success text-v2-state-fg-success",
  changed: "bg-v2-state-bg-warning text-v2-state-fg-warning",
}

// Bundled skill descriptions list many trigger phrases; the row shows their start.
const DESCRIPTION_CHARS = 140

/** Each bundled skill, whether the user's copy replaces it, and the actions to copy, keep or drop that copy. */
export default function SkillsSection() {
  const ctx = useExtension<typeof definition>()

  const [list, { mutate }] = createResource(
    () => builtin(ctx.servers),
    (current) => current.client.jabisu.skills.list({ location: locationOf(current) }),
  )

  const act = useMutation(() => ({
    mutationFn: async (input: { action: "turn" | "copy" | "keep" | "reset"; skill: JabisuSkill }) => {
      const current = builtin(ctx.servers)

      if (!current) return

      const location = locationOf(current)
      const name = input.skill.name

      if (input.action === "turn") {
        mutate(await current.client.jabisu.skills.turn({ location, name, on: !input.skill.on }))

        return
      }

      if (input.action === "copy") {
        mutate(await current.client.jabisu.skills.copy({ location, name }))
        showToast({
          variant: "success",
          title: ctx.t("copied.title"),
          description: ctx.t("copied.description", { name }),
        })

        return
      }

      if (input.action === "keep") {
        mutate(await current.client.jabisu.skills.keep({ location, name }))

        return
      }

      const reply = await current.client.jabisu.skills.reset({ location, name })

      mutate(reply.list)
      showToast({ title: ctx.t("reset.title"), description: ctx.t("reset.description", { backup: reply.backup }) })
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: ctx.t("failed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const reveal = (directory: string) => void ctx.desktop?.reveal(directory)

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section")}</h3>
      <p class="text-13-regular text-text-weak">{ctx.t("intro")}</p>

      <div data-component="settings-list">
        <Show when={list.latest}>
          {(current) => (
            <Row title={ctx.t("folder.title")} description={ctx.t("folder.description", { folder: current().folder })}>
              <Button type="button" size="small" variant="ghost" onClick={() => reveal(current().folder)}>
                {ctx.t("action.open")}
              </Button>
            </Row>
          )}
        </Show>

        <For each={list.latest?.skills ?? []}>
          {(skill) => (
            <Row
              title={skill.title ? `${skill.name} · ${skill.title}` : skill.name}
              description={
                skill.summary ??
                (skill.description.length > DESCRIPTION_CHARS
                  ? `${skill.description.slice(0, DESCRIPTION_CHARS)}…`
                  : skill.description)
              }
            >
              <div
                data-action={`settings-bundled-skill-${skill.name}`}
                class="flex flex-wrap items-center justify-end gap-2"
              >
                <Button
                  type="button"
                  size="small"
                  variant={skill.on ? "ghost" : "neutral"}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: "turn", skill })}
                >
                  {ctx.t(skill.on ? "action.turnOff" : "action.turnOn")}
                </Button>
                <Show when={!skill.on}>
                  <span class={`rounded-[4px] px-1.5 py-0.5 text-12-medium ${BADGE.default}`}>
                    {ctx.t("status.off")}
                  </span>
                </Show>
                <span class={`rounded-[4px] px-1.5 py-0.5 text-12-medium ${BADGE[skill.status]}`}>
                  {ctx.t(`status.${skill.status}`)}
                </span>
                <Show
                  when={skill.directory}
                  fallback={
                    <Button
                      type="button"
                      size="small"
                      variant="neutral"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ action: "copy", skill })}
                    >
                      {ctx.t("action.copy")}
                    </Button>
                  }
                >
                  {(directory) => (
                    <>
                      <Show when={skill.status === "changed"}>
                        <Button
                          type="button"
                          size="small"
                          variant="neutral"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ action: "keep", skill })}
                        >
                          {ctx.t("action.keep")}
                        </Button>
                      </Show>
                      <Button type="button" size="small" variant="ghost" onClick={() => reveal(directory())}>
                        {ctx.t("action.open")}
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ action: "reset", skill })}
                      >
                        {ctx.t("action.reset")}
                      </Button>
                    </>
                  )}
                </Show>
              </div>
            </Row>
          )}
        </For>
      </div>
    </div>
  )
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
