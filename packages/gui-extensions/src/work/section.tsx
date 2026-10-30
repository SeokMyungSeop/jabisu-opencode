import { createResource, For, onCleanup, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import type { JabisuWork, JabisuWorkFolder } from "@opencode/client/promise"
import { builtin, locationOf } from "../builtin-server"
import { useExtension } from "../sdk"
import type definition from "./index"

// Files dropped into a folder from Explorer change its counts, so they are read again this often while shown.
const REFRESH_MS = 3_000

type Kind = "received" | "saved"

/** 자비수's own work folder with the work profile, then the received-file and saved-work folders the user chooses. */
export default function WorkSection() {
  const ctx = useExtension<typeof definition>()

  const [status, { mutate, refetch }] = createResource(
    () => builtin(ctx.servers),
    (current) => current.client.jabisu.work.get({ location: locationOf(current) }),
  )

  const timer = setInterval(() => void refetch(), REFRESH_MS)

  onCleanup(() => clearInterval(timer))

  const save = useMutation(() => ({
    mutationFn: async (choice: { received: string[]; saved: string[] }) => {
      const current = builtin(ctx.servers)

      if (!current) return

      mutate(await current.client.jabisu.work.update({ location: locationOf(current), ...choice }))
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: ctx.t("failed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const chosen = (work: JabisuWork) => ({
    received: work.received.map((folder) => folder.path),
    saved: work.saved.map((folder) => folder.path),
  })

  const add = (kind: Kind, folder: string) => {
    const work = status.latest

    if (!work) return
    const current = chosen(work)

    save.mutate({ ...current, [kind]: [...current[kind], folder] })
  }

  const remove = (kind: Kind, folder: string) => {
    const work = status.latest

    if (!work) return
    const current = chosen(work)

    save.mutate({ ...current, [kind]: current[kind].filter((item) => item !== folder) })
  }

  const choose = async (kind: Kind) => {
    const picked = await ctx.desktop?.chooseFolder(ctx.t(`${kind}.picker`))

    if (picked) add(kind, picked)
  }

  // Opens a folder itself in Explorer, or a file in its app.
  const open = (target: string) => void ctx.desktop?.launch(target)

  const coverage = (folder: JabisuWorkFolder) =>
    folder.files === 0
      ? ctx.t("folder.waiting")
      : ctx.t("folder.status", { files: folder.files, documents: folder.documents, ready: folder.ready }) +
        (folder.pending ? ctx.t("folder.reading", { pending: folder.pending }) : "")

  const folders = (kind: Kind, list: readonly JabisuWorkFolder[]) => (
    <For each={list}>
      {(folder) => (
        <Row nested title={folder.path} description={coverage(folder)}>
          <Button type="button" size="small" variant="ghost" onClick={() => open(folder.path)}>
            {ctx.t("action.open")}
          </Button>
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => remove(kind, folder.path)}
          >
            {ctx.t("action.remove")}
          </Button>
        </Row>
      )}
    </For>
  )

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section")}</h3>
      <p class="text-13-regular text-text-weak">{ctx.t("intro")}</p>

      <Show when={status.latest}>
        {(current) => (
          <>
            <div data-component="settings-list">
              <Row title={ctx.t("jabisu.title")} description={ctx.t("jabisu.description")} />
              <Row nested title={current().jabisu.path} description={coverage(current().jabisu)}>
                <Button type="button" size="small" variant="ghost" onClick={() => open(current().jabisu.path)}>
                  {ctx.t("action.open")}
                </Button>
              </Row>
              <Row
                nested
                title={ctx.t("profile.title")}
                description={current().profile.exists ? current().profile.path : ctx.t("profile.missing")}
              >
                <Show when={current().profile.exists}>
                  <Button type="button" size="small" variant="neutral" onClick={() => open(current().profile.path)}>
                    {ctx.t("profile.open")}
                  </Button>
                </Show>
              </Row>
            </div>

            <div data-component="settings-list">
              <Row title={ctx.t("received.title")} description={ctx.t("received.description")}>
                <Button
                  type="button"
                  size="small"
                  variant="neutral"
                  disabled={save.isPending}
                  onClick={() => void choose("received")}
                >
                  {ctx.t("action.add")}
                </Button>
              </Row>
              {folders("received", current().received)}
              <Show when={current().candidates.length}>
                <Row nested stacked title={ctx.t("found.title")} description={ctx.t("found.description")}>
                  <For each={current().candidates}>
                    {(candidate) => (
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        title={candidate.path}
                        disabled={save.isPending}
                        onClick={() => add("received", candidate.path)}
                      >
                        {ctx.t("found.add", { name: ctx.t(`kind.${candidate.kind}`, { name: tail(candidate.path) }) })}
                      </Button>
                    )}
                  </For>
                </Row>
              </Show>
            </div>

            <div data-component="settings-list">
              <Row title={ctx.t("saved.title")} description={ctx.t("saved.description")}>
                <Button
                  type="button"
                  size="small"
                  variant="neutral"
                  disabled={save.isPending}
                  onClick={() => void choose("saved")}
                >
                  {ctx.t("action.choose")}
                </Button>
              </Row>
              {folders("saved", current().saved)}
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

// A folder's own name, the last part of its path.
const tail = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder

// The host's settings row markup; its stylesheet is loaded with the settings screen. A nested row belongs to the
// group row above it. The host keeps its controls on one line beside the text, so a stacked row puts a list of them
// under the text, where it wraps instead of squeezing the text into a column one letter wide.
function Row(props: { title: string; description: string; nested?: boolean; stacked?: boolean; children?: JSX.Element }) {
  return (
    <div data-component="settings-row" classList={{ "pl-4": props.nested }}>
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
        <Show when={props.stacked}>
          <div class="-ms-2 flex flex-wrap items-center gap-1">{props.children}</div>
        </Show>
      </div>
      <Show when={!props.stacked}>
        <div data-slot="settings-row-control" class="flex flex-wrap items-center justify-end gap-2">
          {props.children}
        </div>
      </Show>
    </div>
  )
}
