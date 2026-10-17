import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { Schema } from "effect"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Tooltip } from "@opencode/ui/tooltip"
import {
  createContext,
  createEffect,
  createMemo,
  on,
  onCleanup,
  Show,
  untrack,
  useContext,
  type Component,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerKey } from "@/runtime/server/persistence"
import type { ServerConnection } from "@/runtime/server/registry"
import { SessionPaneProvider } from "@/session/pane"
import { requireServerKey, sessionHref } from "@/shell/routes/session"

/** The narrowest a split pane gets. */
export const SPLIT_PANE_WIDTH_MIN = 360

/** The window width below which the split hides. */
const SPLIT_WINDOW_WIDTH_MIN = 1024

const SplitState = Persistence.struct({
  server: Persistence.optional(ServerKey),
  session: Persistence.optional(Schema.String),
  width: Persistence.optional(Schema.Finite),
})

const SESSION_PATH = /^\/server\/([^/]+)\/session\/([^/]+)$/

function createSplit() {
  const [store, setStore] = persisted(Persist.window("split"), SplitState, {})

  const pane = createMemo(
    () => (store.server && store.session ? { server: store.server, sessionID: store.session } : undefined),
    undefined,
    { equals: (a, b) => a?.server === b?.server && a?.sessionID === b?.sessionID },
  )

  return {
    /** The session the second pane shows; undefined while the window is not split. */
    pane,
    /** The second pane's width in pixels, once the user resized it. */
    width: () => store.width,
    /** Shows a session in the second pane, splitting the window when it is not split yet. */
    open: (server: ServerConnection.Key, sessionID: string) =>
      setStore((state) => ({ ...state, server, session: sessionID })),
    close: () => setStore((state) => ({ ...state, server: undefined, session: undefined })),
    resize: (width: number) => setStore("width", width),
  }
}

export type Split = ReturnType<typeof createSplit>

const SplitContext = createContext<Split>()

/** The window's split view: one per window, stored with the window's tabs. */
export function SplitProvider(props: ParentProps) {
  return <SplitContext.Provider value={createSplit()}>{props.children}</SplitContext.Provider>
}

export function useSplit() {
  const split = useContext(SplitContext)

  if (!split) throw new Error("useSplit must be used within SplitProvider")

  return split
}

/**
 * Lays the routed session out beside the split's second pane on wide windows. The routed session stays mounted when
 * the split opens or closes. `pane` renders the second pane's session route.
 */
export function SplitLayout(props: ParentProps<{ pane: Component }>) {
  const split = useSplit()
  const wide = createMediaQuery(`(min-width: ${SPLIT_WINDOW_WIDTH_MIN}px)`)
  const [row, setRow] = createStore({ width: 0 })
  let element: HTMLDivElement | undefined
  createResizeObserver(
    () => element,
    ({ width }) => setRow("width", width),
  )

  const max = () => Math.max(SPLIT_PANE_WIDTH_MIN, row.width - SPLIT_PANE_WIDTH_MIN)
  const width = () => Math.max(SPLIT_PANE_WIDTH_MIN, Math.min(max(), split.width() ?? Math.round(row.width / 2)))

  return (
    <div ref={element} class="flex size-full min-h-0 flex-row">
      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
      <Show when={wide() && split.pane()}>
        <div
          data-component="session-split-pane"
          class="relative flex min-h-0 shrink-0 flex-col"
          style={{ width: `${width()}px` }}
        >
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={width()}
            min={SPLIT_PANE_WIDTH_MIN}
            max={max()}
            onResize={split.resize}
          />
          <props.pane />
        </div>
      </Show>
    </div>
  )
}

/**
 * The second pane's own router, so the session route and everything under it read the pane's session. Moving to
 * another session inside the pane moves the split; leaving sessions ends it. Only links marked `link` are its own, so
 * it never takes the window's tab links.
 */
export function SplitPaneRouter(props: { route: Component }) {
  const split = useSplit()
  const language = useLanguage()
  const history = createMemoryHistory()
  const initial = untrack(split.pane)

  if (initial) history.set({ value: sessionHref(initial.server, initial.sessionID), replace: true, scroll: false })

  // Another session opened in the split while the pane shows one.
  createEffect(
    on(
      split.pane,
      (pane) => {
        if (!pane) return
        const href = sessionHref(pane.server, pane.sessionID)

        if (history.get().split(/[?#]/, 1)[0] !== href) history.set({ value: href, scroll: false })
      },
      { defer: true },
    ),
  )

  onCleanup(
    history.listen((value) => {
      const match = SESSION_PATH.exec(value.split(/[?#]/, 1)[0] ?? "")
      const server = match ? parseServerKey(match[1]) : undefined

      if (!match || !server) {
        split.close()

        return
      }

      split.open(server, match[2])
    }),
  )

  return (
    <SessionPaneProvider value={{ secondary: true, close: split.close }}>
      <div class="absolute end-[calc(var(--shell-inline-inset,8px)+12px)] top-[calc(var(--shell-top-inset,8px)+8px)] z-40">
        <Tooltip value={language.t("split.close")} placement="bottom">
          <IconButton
            variant="ghost-muted"
            size="large"
            icon={<Icon name="xmark-small" />}
            aria-label={language.t("split.close")}
            onClick={split.close}
          />
        </Tooltip>
      </div>
      <MemoryRouter history={history} explicitLinks>
        <Route path="/server/:serverKey/session/:id" component={props.route} />
      </MemoryRouter>
    </SessionPaneProvider>
  )
}

function parseServerKey(segment: string | undefined) {
  try {
    return requireServerKey(segment)
  } catch {
    return
  }
}
