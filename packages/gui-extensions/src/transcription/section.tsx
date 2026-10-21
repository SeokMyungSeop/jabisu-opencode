import { createResource, createSignal, type JSX } from "solid-js"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@opencode/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createKeyed, useExtension } from "../sdk"
import type definition from "./index"

/** Whether recordings read as transcripts, and the OpenRouter model that writes them. The engine owns the setting. */
export default function TranscriptionSection() {
  const ctx = useExtension<typeof definition>()

  const server = () =>
    ctx.servers
      .list()
      .map((id) => ctx.servers.get(id))
      .find((item) => item?.builtin)

  // Connecting or removing OpenRouter in the providers settings updates this list, which reloads the status below.
  const connections = () =>
    server()
      ?.data.location.integration.list()
      ?.find((integration) => integration.id === "openrouter")?.connections.length

  createKeyed(server, (current) => void current.data.location.integration.sync())

  const [status, { mutate }] = createResource(
    () => {
      const current = server()

      return current ? { current, connections: connections() } : undefined
    },
    ({ current }) =>
      current.client.jabisu.transcription.get({ location: { directory: current.data.location.default().directory } }),
  )

  // What the model field shows while the user types; it is saved when the field loses focus.
  const [typed, setTyped] = createSignal<string>()

  const save = useMutation(() => ({
    mutationFn: async (input: { enabled: boolean; model?: string }) => {
      const current = server()

      if (!current) return

      const location = { directory: current.data.location.default().directory }

      mutate(await current.client.jabisu.transcription.update({ location, ...input }))
      setTyped(undefined)
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: ctx.t("saveFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const model = () => {
    const current = status()

    if (!current) return ""

    return typed() ?? (current.model === current.defaultModel ? "" : current.model)
  }

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section")}</h3>

      <div data-component="settings-list">
        <Row
          title={ctx.t("enabled.title")}
          description={
            status()?.openrouter === false && !status()?.enabled
              ? ctx.t("enabled.openrouter")
              : ctx.t("enabled.description")
          }
        >
          <div data-action="settings-transcription-enabled">
            <Switch
              checked={status()?.enabled ?? false}
              disabled={!status() || save.isPending || (!status()?.openrouter && !status()?.enabled)}
              onChange={(enabled) => save.mutate({ enabled, model: model() })}
            />
          </div>
        </Row>

        <Row
          title={ctx.t("model.title")}
          description={ctx.t("model.description", { model: status()?.defaultModel ?? "" })}
        >
          <div data-action="settings-transcription-model" class="w-64">
            <TextField
              label={ctx.t("model.title")}
              hideLabel
              placeholder={status()?.defaultModel}
              value={model()}
              disabled={!status()}
              onChange={setTyped}
              onBlur={() => {
                const current = status()

                if (current && typed() !== undefined) save.mutate({ enabled: current.enabled, model: typed() })
              }}
            />
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
