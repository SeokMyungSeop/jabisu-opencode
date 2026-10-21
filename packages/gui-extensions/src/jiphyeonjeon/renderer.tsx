import { createMemo, createResource, lazy, onCleanup, Show, Suspense } from "solid-js"
import {
  Command,
  createKeyed,
  onIdle,
  Panel,
  Slot,
  TitlebarItem,
  type MountedSession,
  type PanelTab,
  type Setup,
} from "../sdk"
import type definition from "./index"
import { builtin, createSync, locationOf, sameDirectory } from "./state"

const Manager = lazy(() => import("./manager"))

const HomeSection = lazy(() => import("./home"))

const SourcesPanel = lazy(() => import("./panel"))

const setup: Setup<typeof definition> = (ctx) => {
  // A 집현전 lives on the desktop's own server, which keeps its folders on this PC.
  if (!ctx.desktop) return

  onCleanup(onIdle(() => void Manager.preload()))

  const sync = createSync()

  const open = (input: { name?: string; create?: boolean } = {}) => {
    ctx.dialogs.open((dialog) => (
      <Suspense>
        <Manager dialog={dialog} sync={sync} name={input.name} create={input.create} />
      </Suspense>
    ))
  }

  ctx.add(TitlebarItem, {
    id: "open",
    icon: "archive",
    get label() {
      return ctx.t("title")
    },
    run: () => open(),
  })
  ctx.add(Command, {
    id: "open",
    get title() {
      return ctx.t("command.open")
    },
    run: () => open(),
  })
  ctx.add(Slot, {
    at: "home.projects.top",
    render: () => (
      <Suspense>
        <HomeSection sync={sync} open={open} />
      </Suspense>
    ),
  })

  // Which sessions are 집현전 chats: those held in a 집현전's folder.
  const [list] = createResource(
    () => {
      const current = builtin(ctx.servers)

      return current ? { current, revision: sync.revision() } : undefined
    },
    ({ current }) => current.client.jabisu.jiphyeonjeon.list({ location: locationOf(current) }),
  )

  const held = (session: MountedSession) =>
    list.latest?.items.find((item) => sameDirectory(item.directory, session.directory))

  const tab: PanelTab = {
    id: "sources",
    get title() {
      return ctx.t("panel.title")
    },
    pinned: true,
    fallback: true,
  }

  ctx.add(
    Panel,
    (): Panel => ({
      id: "sources",
      region: "side",
      list: (input) => (held(input.session) ? [tab] : []),
      render: (props) => {
        const item = createMemo(() => held(props.session))

        return (
          <Show when={item()}>
            {(found) => (
              <Suspense>
                <SourcesPanel item={found()} writer={list.latest} sync={sync} session={props.session} />
              </Suspense>
            )}
          </Show>
        )
      },
    }),
  )

  // A 집현전 chat shows its sources the first time it is routed in this window; closing them afterwards sticks.
  const shown = new Set<string>()

  createKeyed(
    () => {
      const session = ctx.sessions.current()

      return session && held(session) ? session : undefined
    },
    (session) => {
      if (shown.has(session.key)) return

      shown.add(session.key)
      ctx.layout.open(`${ctx.id}:sources`, session, { tab: "select" })
    },
    { equals: (previous, next) => previous.key === next.key },
  )
}

export default setup
