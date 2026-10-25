import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type { Jiphyeonjeon, JiphyeonjeonSource } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { FileIcon } from "@opencode/ui/file-icon"
import { Textarea } from "@opencode/ui/textarea"
import { showToast } from "@opencode/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { useExtension } from "../sdk"
import type definition from "./index"
import { freeName } from "./names"
import { builtin, locationOf, type Sync } from "./state"

const BADGE: Record<JiphyeonjeonSource["status"], string> = {
  ready: "bg-v2-state-bg-success text-v2-state-fg-success",
  pending: "bg-v2-state-bg-info text-v2-state-fg-info",
  unsupported: "bg-v2-state-bg-warning text-v2-state-fg-warning",
  unreadable: "bg-v2-state-bg-danger text-v2-state-fg-danger",
}

function useFailed() {
  const ctx = useExtension<typeof definition>()

  return (error: Error) => showToast({ variant: "error", title: ctx.t("failed"), description: error.message })
}

/** Where suggested instructions are written: OpenRouter's `suggestModel` when a key is there, else the default model. */
export interface Writer {
  readonly openrouter: boolean
  readonly suggestModel: string
}

/**
 * Writes suggested instructions. Before the sources' beginnings first go to OpenRouter it asks the user, who can agree
 * once or for good; without OpenRouter the default model writes them, and a failure says OpenRouter would do.
 */
function useSuggest() {
  const ctx = useExtension<typeof definition>()

  const ask = (model: string) =>
    new Promise<"once" | "always" | undefined>((resolve) => {
      ctx.dialogs.open((dialog) => (
        <Consent
          model={model}
          onAnswer={(answer) => {
            resolve(answer)
            dialog.close()
          }}
        />
      ))
    })

  const suggest = async (name: string, writer: Writer | undefined) => {
    const current = builtin(ctx.servers)

    if (!current) return undefined

    const remembered = ctx.stores.consent.value.openrouter ? "always" : undefined
    const answer = writer?.openrouter ? (remembered ?? (await ask(writer.suggestModel))) : "default"

    if (!answer) return undefined

    if (answer === "always")
      ctx.stores.consent.update((draft) => {
        draft.openrouter = true
      })

    const location = locationOf(current)
    const reply = await current.client.jabisu.jiphyeonjeon.suggest({ location, name, openrouter: answer !== "default" })

    return reply.instructions
  }

  const failed = (writer: Writer | undefined) => (error: Error) =>
    showToast({
      variant: "error",
      title: ctx.t("failed"),
      description: writer?.openrouter ? error.message : `${error.message}\n${ctx.t("suggest.openrouter")}`,
    })

  return { suggest, failed }
}

function Consent(props: { model: string; onAnswer: (answer: "once" | "always" | undefined) => void }) {
  const ctx = useExtension<typeof definition>()

  // Closing the dialog any other way is a no.
  onCleanup(() => props.onAnswer(undefined))

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={ctx.t("consent.title")}
          description={ctx.t("consent.description", { model: props.model })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => props.onAnswer(undefined)}>
          {ctx.t("action.cancel")}
        </Button>
        <Button type="button" variant="neutral" onClick={() => props.onAnswer("once")}>
          {ctx.t("consent.once")}
        </Button>
        <Button type="button" variant="contrast" autofocus onClick={() => props.onAnswer("always")}>
          {ctx.t("consent.always")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * A 집현전's sources with whether search can read each, a drop zone and a picker. Adding sources to a 집현전 without
 * instructions also writes recommended ones from them.
 */
export function Sources(props: {
  item: Jiphyeonjeon
  writer: Writer | undefined
  sync: Sync
  onOpen: (path: string) => void
}) {
  const ctx = useExtension<typeof definition>()
  const failed = useFailed()
  const writing = useSuggest()
  const [dragging, setDragging] = createSignal(false)
  const [suggesting, setSuggesting] = createSignal(false)
  let picker: HTMLInputElement | undefined

  const [statuses] = createResource(
    () => {
      const current = builtin(ctx.servers)

      return current
        ? { current, name: props.item.name, sources: props.item.sources.length, revision: props.sync.revision() }
        : undefined
    },
    ({ current, name }) => current.client.jabisu.jiphyeonjeon.sources({ location: locationOf(current), name }),
  )

  const status = createMemo(() => new Map((statuses.latest ?? []).map((source) => [source.path, source])))

  // Writes recommended instructions from the sources when the 집현전 has none yet. The view's listing can be older
  // than the folder, so the 집현전 is listed again first.
  const recommend = async () => {
    const current = builtin(ctx.servers)

    if (!current) return

    const location = locationOf(current)
    const name = props.item.name
    const latest = await current.client.jabisu.jiphyeonjeon.list({ location })

    if (latest.items.find((item) => item.name === name)?.instructions !== "") return

    setSuggesting(true)

    const instructions = await writing
      .suggest(name, latest)
      .catch((error: Error) => void writing.failed(latest)(error))
      .finally(() => setSuggesting(false))

    if (!instructions) return

    await current.client.jabisu.jiphyeonjeon.instruct({ location, name, instructions })
    props.sync.changed()
  }

  // Files keep their names; a name already among the sources gets a number, so nothing is overwritten.
  const add = useMutation(() => ({
    mutationFn: async (files: readonly File[]) => {
      const current = builtin(ctx.servers)

      if (!current) return

      const location = locationOf(current)
      const taken = new Set(props.item.sources)

      for (const file of files) {
        const name = freeName(file.name, taken)

        taken.add(name)
        await current.client.file.write({
          location,
          path: `${props.item.directory}/자료/${name}`,
          payload: new Uint8Array(await file.arrayBuffer()),
        })
      }

      props.sync.changed()
      await recommend()
    },
    onError: failed,
  }))

  // Files put into the sources folder outside the app, such as from File Explorer, get instructions the same way.
  onCleanup(
    props.sync.arrived(
      () => props.item.name,
      () => {
        if (add.isPending || suggesting()) return
        void recommend().catch(failed)
      },
    ),
  )

  const take = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])]

    if (files.length) add.mutate(files)
  }

  return (
    <section
      class="flex min-h-0 flex-col gap-2 rounded-[8px] border border-border-base p-3"
      classList={{ "bg-surface-raised-base": dragging() }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        take(event.dataTransfer?.files)
      }}
    >
      <div class="flex items-center gap-2">
        <span class="flex-1 text-14-medium text-text-strong">
          {ctx.t("sources.title", { count: props.item.sources.length })}
        </span>
        <Button type="button" size="small" variant="neutral" disabled={add.isPending} onClick={() => picker?.click()}>
          {ctx.t("action.add")}
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = event.currentTarget.files

            take(files)
            event.currentTarget.value = ""
          }}
        />
      </div>
      <Show
        when={props.item.sources.length}
        fallback={<p class="text-13-regular text-text-weak">{ctx.t("sources.empty")}</p>}
      >
        <ul class="flex min-h-0 flex-col gap-0.5 overflow-auto">
          <For each={props.item.sources}>
            {(source) => (
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-surface-raised-base-hover"
                  title={status().get(source)?.reason ?? source}
                  onClick={() => props.onOpen(`${props.item.directory}/자료/${source}`)}
                >
                  <FileIcon node={{ path: source, type: "file" }} class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate text-13-regular text-text-base">{source}</span>
                  <Show when={status().get(source)}>
                    {(found) => (
                      <span class={`shrink-0 rounded-[4px] px-1.5 text-11-regular ${BADGE[found().status]}`}>
                        {ctx.t(`status.${found().status}`)}
                      </span>
                    )}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="text-12-regular text-text-weak">
        {suggesting() ? ctx.t("instructions.writing") : add.isPending ? ctx.t("sources.adding") : ctx.t("sources.drop")}
      </p>
    </section>
  )
}

/** The instructions in P-C-T-F form: shown, edited in place, or written anew from the sources. */
export function Instructions(props: { item: Jiphyeonjeon; writer: Writer | undefined; sync: Sync }) {
  const ctx = useExtension<typeof definition>()
  const failed = useFailed()
  const writing = useSuggest()
  const [draft, setDraft] = createSignal<string>()

  const save = useMutation(() => ({
    mutationFn: async (text: string) => {
      const current = builtin(ctx.servers)

      if (!current) return

      await current.client.jabisu.jiphyeonjeon.instruct({
        location: locationOf(current),
        name: props.item.name,
        instructions: text,
      })
      setDraft(undefined)
      props.sync.changed()
    },
    onError: failed,
  }))

  // A suggestion lands in the editor for the user to read and save; nothing changes until then.
  const suggest = useMutation(() => ({
    mutationFn: async () => {
      const instructions = await writing.suggest(props.item.name, props.writer)

      if (instructions !== undefined) setDraft(instructions)
    },
    onError: (error) => writing.failed(props.writer)(error),
  }))

  return (
    <section class="flex flex-col gap-2 rounded-[8px] border border-border-base p-3">
      <div class="flex items-center gap-2">
        <span class="flex-1 text-14-medium text-text-strong">{ctx.t("instructions.title")}</span>
        <Show when={draft() === undefined}>
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={suggest.isPending || !props.item.sources.length}
            onClick={() => suggest.mutate()}
          >
            {suggest.isPending ? ctx.t("instructions.writing") : ctx.t("instructions.suggest")}
          </Button>
          <Button type="button" size="small" variant="neutral" onClick={() => setDraft(props.item.instructions)}>
            {ctx.t("instructions.edit")}
          </Button>
        </Show>
      </div>
      <Show
        when={draft() !== undefined}
        fallback={
          <p class="whitespace-pre-wrap text-13-regular text-text-base">
            {props.item.instructions || ctx.t("instructions.empty")}
          </p>
        }
      >
        <Textarea
          rows={7}
          value={draft() ?? ""}
          placeholder={ctx.t("instructions.placeholder")}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <div class="flex items-center justify-end gap-2">
          <span class="flex-1 text-12-regular text-text-weak">
            {ctx.t("instructions.length", { count: (draft() ?? "").length })}
          </span>
          <Button type="button" size="small" variant="ghost" onClick={() => setDraft(undefined)}>
            {ctx.t("action.cancel")}
          </Button>
          <Button
            type="button"
            size="small"
            variant="contrast"
            disabled={save.isPending}
            onClick={() => save.mutate(draft() ?? "")}
          >
            {ctx.t("instructions.save")}
          </Button>
        </div>
      </Show>
    </section>
  )
}
