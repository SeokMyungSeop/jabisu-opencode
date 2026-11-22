import { createResource, createSignal, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Textarea } from "@opencode/ui/textarea"
import { showToast } from "@opencode/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { builtin, locationOf } from "../builtin-server"
import { useExtension } from "../sdk"
import type definition from "./index"

/**
 * 「가져오기」: the user copies a prompt, sends it to another AI assistant, and pastes its answer here. The answer is
 * added to a file every conversation reads, which the user can open and edit.
 */
export default function BringSection() {
  const ctx = useExtension<typeof definition>()

  const [status, { mutate }] = createResource(
    () => builtin(ctx.servers),
    (current) => current.client.jabisu.brought.get({ location: locationOf(current) }),
  )

  const [pasted, setPasted] = createSignal("")

  const copy = () =>
    void ctx.system.copy(ctx.t("prompt")).then(
      () => showToast({ variant: "success", title: ctx.t("copy.done") }),
      () => showToast({ variant: "error", title: ctx.t("copy.failed") }),
    )

  const bring = useMutation(() => ({
    mutationFn: async (text: string) => {
      const current = builtin(ctx.servers)

      if (!current) return

      mutate(await current.client.jabisu.brought.add({ location: locationOf(current), text }))
      setPasted("")
      showToast({ variant: "success", title: ctx.t("bring.done"), description: ctx.t("bring.doneDetail") })
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: ctx.t("bring.failed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section")}</h3>
      <p class="text-13-regular text-text-weak">{ctx.t("intro")}</p>

      <div data-component="settings-list">
        <Row title={ctx.t("copy.title")} description={ctx.t("copy.description")}>
          <Button type="button" size="small" variant="neutral" data-action="settings-bring-copy" onClick={copy}>
            {ctx.t("copy.action")}
          </Button>
        </Row>
        <Row title={ctx.t("paste.title")} description={ctx.t("paste.description")}>
          <div data-action="settings-bring-paste" class="flex w-96 flex-col gap-2">
            <Textarea
              rows={6}
              aria-label={ctx.t("paste.title")}
              placeholder={ctx.t("paste.placeholder")}
              value={pasted()}
              disabled={!status() || bring.isPending}
              onInput={(event) => setPasted(event.currentTarget.value)}
            />
            <Button
              type="button"
              size="small"
              variant="neutral"
              class="self-end"
              disabled={!pasted().trim() || bring.isPending}
              onClick={() => bring.mutate(pasted())}
            >
              {ctx.t("bring.action")}
            </Button>
          </div>
        </Row>
        <Show when={status()}>
          {(current) => (
            <Row
              title={ctx.t("file.title")}
              description={
                current().exists ? ctx.t("file.has", { path: current().path, chars: current().chars }) : ctx.t("file.none")
              }
            >
              <Show when={current().exists}>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={() => void ctx.desktop?.launch(current().path)}
                >
                  {ctx.t("file.open")}
                </Button>
              </Show>
            </Row>
          )}
        </Show>
      </div>
    </div>
  )
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children?: JSX.Element }) {
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
