import { createResource, createSignal, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@opencode/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { builtin, locationOf } from "../builtin-server"
import { useExtension } from "../sdk"
import type definition from "./index"

/** The key for 법제처's law database. The server checks a new key with one search before it saves it. */
export default function LawSection() {
  const ctx = useExtension<typeof definition>()

  const [status, { mutate }] = createResource(
    () => builtin(ctx.servers),
    (current) => current.client.jabisu.law.get({ location: locationOf(current) }),
  )

  const [typed, setTyped] = createSignal("")

  const save = useMutation(() => ({
    mutationFn: async (key: string) => {
      const current = builtin(ctx.servers)

      if (!current) return

      mutate(await current.client.jabisu.law.update({ location: locationOf(current), key }))
      setTyped("")
      showToast({ variant: "success", title: ctx.t(key.trim() ? "saved" : "removed") })
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: ctx.t("saveFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section")}</h3>

      <div data-component="settings-list">
        <Row title={ctx.t("key.title")} description={ctx.t("key.description")}>
          <div data-action="settings-law-key" class="flex w-80 flex-col gap-2">
            <TextField
              label={ctx.t("key.title")}
              hideLabel
              placeholder={ctx.t("key.placeholder")}
              value={typed()}
              disabled={!status() || save.isPending}
              onChange={setTyped}
            />
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-12-regular text-v2-text-text-muted">
                {status()?.configured ? ctx.t("key.saved", { masked: status()?.masked ?? "" }) : ctx.t("key.none")}
              </span>
              <div class="flex shrink-0 gap-1">
                <Show when={status()?.configured}>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={save.isPending}
                    onClick={() => save.mutate("")}
                  >
                    {ctx.t("key.remove")}
                  </Button>
                </Show>
                <Button
                  type="button"
                  size="small"
                  variant="neutral"
                  disabled={!typed().trim() || save.isPending}
                  onClick={() => save.mutate(typed())}
                >
                  {ctx.t("key.save")}
                </Button>
              </div>
            </div>
            <Button
              type="button"
              size="small"
              variant="ghost"
              class="self-start"
              onClick={() => {
                const apply = status()?.apply

                if (apply) ctx.system.openExternal(apply)
              }}
            >
              {ctx.t("key.apply")}
            </Button>
          </div>
        </Row>
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
