import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import type { Jiphyeonjeon } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@opencode/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { useExtension, type DialogHandle } from "../sdk"
import type definition from "./index"
import { Instructions, Sources, type Writer } from "./parts"
import { builtin, locationOf, type Sync } from "./state"

/** The 집현전 window: every 집현전 on the left; the chosen one's sources, instructions and chats on the right. */
export default function Manager(props: { dialog: DialogHandle; sync: Sync; name?: string; create?: boolean }) {
  const ctx = useExtension<typeof definition>()
  const [chosen, setChosen] = createSignal(props.name)
  const [creating, setCreating] = createSignal(props.create ?? false)
  const [name, setName] = createSignal("")

  const [list] = createResource(
    () => {
      const current = builtin(ctx.servers)

      return current ? { current, revision: props.sync.revision() } : undefined
    },
    ({ current }) => current.client.jabisu.jiphyeonjeon.list({ location: locationOf(current) }),
  )

  const current = createMemo(() => {
    const items = list.latest?.items ?? []

    return items.find((item) => item.name === chosen()) ?? items[0]
  })

  const create = useMutation(() => ({
    mutationFn: async (value: string) => {
      const server = builtin(ctx.servers)

      if (!server) return

      const item = await server.client.jabisu.jiphyeonjeon.create({ location: locationOf(server), name: value })

      setName("")
      setCreating(false)
      setChosen(item.name)
      props.sync.changed()
    },
    onError: (error) => showToast({ variant: "error", title: ctx.t("failed"), description: error.message }),
  }))

  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("title")} description={ctx.t("description")} />
      </DialogHeader>
      <DialogBody class="min-h-0 px-4 pb-4">
        <Show
          when={list.latest}
          fallback={
            <div class="flex flex-1 items-center justify-center">
              <Loader />
            </div>
          }
        >
          {(data) => (
            <div class="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)] gap-4">
              <nav class="flex min-h-0 flex-col gap-2 border-r border-border-base pr-3">
                <Show
                  when={creating()}
                  fallback={
                    <Button type="button" variant="neutral" icon="plus" onClick={() => setCreating(true)}>
                      {ctx.t("create.open")}
                    </Button>
                  }
                >
                  <form
                    class="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()

                      if (name().trim()) create.mutate(name())
                    }}
                  >
                    <TextField
                      label={ctx.t("create.label")}
                      hideLabel
                      autofocus
                      placeholder={ctx.t("create.placeholder")}
                      value={name()}
                      onChange={setName}
                    />
                    <div class="flex justify-end gap-1">
                      <Button type="button" size="small" variant="ghost" onClick={() => setCreating(false)}>
                        {ctx.t("action.cancel")}
                      </Button>
                      <Button
                        type="submit"
                        size="small"
                        variant="contrast"
                        disabled={!name().trim() || create.isPending}
                      >
                        {ctx.t("create.action")}
                      </Button>
                    </div>
                  </form>
                </Show>
                <ul class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
                  <For each={data().items}>
                    {(item) => (
                      <li>
                        <button
                          type="button"
                          class="w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-surface-raised-base-hover"
                          classList={{ "bg-surface-raised-base": item.name === current()?.name }}
                          onClick={() => setChosen(item.name)}
                        >
                          <div class="truncate text-13-medium text-text-strong">{item.name}</div>
                          <div class="text-12-regular text-text-weak">
                            {ctx.t("sources.count", { count: item.sources.length })}
                          </div>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <p class="break-all text-11-regular text-text-weak" title={data().root}>
                  {ctx.t("root", { root: data().root })}
                </p>
              </nav>
              <Show
                when={current()}
                fallback={
                  <div class="flex flex-col items-start justify-center gap-2 p-6">
                    <span class="text-16-medium text-text-strong">{ctx.t("empty.title")}</span>
                    <p class="text-13-regular text-text-weak">{ctx.t("empty")}</p>
                  </div>
                }
              >
                {(item) => (
                  <Show when={item().name} keyed>
                    <Detail item={item()} writer={data()} sync={props.sync} dialog={props.dialog} />
                  </Show>
                )}
              </Show>
            </div>
          )}
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function Detail(props: { item: Jiphyeonjeon; writer: Writer; sync: Sync; dialog: DialogHandle }) {
  const ctx = useExtension<typeof definition>()

  const chat = () => {
    const server = builtin(ctx.servers)

    if (!server) return

    ctx.layout.project(server.id, props.item.name, props.item.directory)
    props.dialog.close()
  }

  return (
    <div class="flex min-h-0 min-w-0 flex-col gap-3">
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-16-medium text-text-strong">{props.item.name}</span>
        <Button type="button" variant="neutral" onClick={() => void ctx.desktop?.reveal(props.item.directory)}>
          {ctx.t("action.folder")}
        </Button>
        <Button type="button" variant="contrast" onClick={chat}>
          {ctx.t("action.chat")}
        </Button>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
        <Sources
          item={props.item}
          writer={props.writer}
          sync={props.sync}
          onOpen={(path) => void ctx.desktop?.launch(path)}
        />
        <div class="flex min-h-0 flex-col gap-3 overflow-auto">
          <Instructions item={props.item} writer={props.writer} sync={props.sync} />
          <Chats item={props.item} dialog={props.dialog} />
        </div>
      </div>
    </div>
  )
}

/** The chats held in a 집현전's folder, newest first; one opens in its tab. */
function Chats(props: { item: Jiphyeonjeon; dialog: DialogHandle }) {
  const ctx = useExtension<typeof definition>()

  const [sessions] = createResource(
    () => {
      const current = builtin(ctx.servers)

      return current ? { current, directory: props.item.directory } : undefined
    },
    ({ current, directory }) =>
      current.client.session.list({ directory, parentID: null, limit: 20, order: "desc" }).then((page) => page.data),
  )

  return (
    <section class="flex flex-col gap-1 rounded-[8px] border border-border-base p-3">
      <span class="text-14-medium text-text-strong">{ctx.t("chats.title")}</span>
      <Show
        when={sessions.latest?.length}
        fallback={<p class="text-13-regular text-text-weak">{ctx.t("chats.empty")}</p>}
      >
        <ul class="flex flex-col gap-0.5">
          <For each={sessions.latest}>
            {(session) => (
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-surface-raised-base-hover"
                  onClick={() => {
                    const server = builtin(ctx.servers)

                    if (!server) return

                    ctx.sessions.open(server.id, session.id)
                    props.dialog.close()
                  }}
                >
                  <span class="min-w-0 flex-1 truncate text-13-regular text-text-base">
                    {session.title || ctx.t("chats.untitled")}
                  </span>
                  <span class="shrink-0 text-12-regular text-text-weak">
                    {new Date(session.time.updated).toLocaleDateString()}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  )
}
