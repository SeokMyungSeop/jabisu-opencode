import { createMemo, createSignal, For, Show, startTransition, type JSX } from "solid-js"
import { Schema } from "effect"
import { useQuery } from "@tanstack/solid-query"
import type { SessionInfo } from "@opencode/client/promise"
import { Icon, type IconProps } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { displayName } from "@opencode/ui/project-avatar"
import { homeSessionQuery, homeSessions } from "@/home/sessions/query"
import { useNewWorkroom } from "@/new-session/workroom"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useServerCtx } from "@/runtime/server/runtime"
import { sessionLabel } from "@/session/title"
import { useSettingsDialog } from "@/settings/command"
import { useCommand } from "@/shell/commands/command"
import type { LocalProject } from "@/shell/state/layout"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { pathKey } from "@/workspaces/path-key"
import { useWorkroomActions } from "./workroom-actions"
import { groupWorkrooms, type Workroom } from "./workrooms"

// Conversations an open room lists before 「더 보기」.
const SHOWN = 6

const JIPHYEONJEON = "jiphyeonjeon.open"

const NavSchema = Persistence.struct({
  open: Schema.Boolean,
  width: Schema.Number,
})

/** Whether 자비수's 작업실 list shows and how wide it is, kept across restarts. */
export function createWorkroomNavState() {
  const [state, setState] = persisted(Persist.global("jabisu.nav"), NavSchema, { open: true, width: 248 })

  return {
    open: () => state.open,
    width: () => state.width,
    toggle: () => setState("open", !state.open),
    resize: (width: number) => setState("width", width),
  }
}

export type WorkroomNavState = ReturnType<typeof createWorkroomNavState>

function NavButton(props: { icon: IconProps["name"]; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="group flex h-8 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
      onClick={() => props.onClick()}
    >
      <Icon name={props.icon} size="small" class="shrink-0 text-v2-icon-icon-base" />
      <span class="min-w-0 truncate">{props.label}</span>
      <Show when={props.hint}>
        {(hint) => (
          <span class="ms-auto shrink-0 text-[12px] text-v2-text-text-faint" aria-hidden="true">
            <bdi dir="ltr">{hint()}</bdi>
          </span>
        )}
      </Show>
    </button>
  )
}

/**
 * 자비수's left-hand list, as in Claude and ChatGPT: 「새 작업실」, conversation search and 집현전 on top, then every
 * 작업실 with its conversations. The room of the conversation on screen opens by itself.
 */
export function WorkroomNav() {
  const language = useLanguage()
  const command = useCommand()
  const layout = useLayout()
  const servers = useServers()
  const tabs = useTabs()
  const openSettings = useSettingsDialog()
  const openWorkroom = useNewWorkroom()

  // The tab on screen: its server lists the rooms, and its folder or conversation is the one marked.
  const current = createMemo(() => {
    const route = layout.route()

    if (route.type === "session") return { server: route.server, session: route.sessionId }

    if (route.type !== "draft") return

    const draft = tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)

    return draft?.type === "draft" ? { server: draft.server, directory: draft.directory } : undefined
  })

  const server = createMemo(() => {
    const key = current()?.server

    return servers.visible.find((conn) => ServerConnection.key(conn) === key) ?? servers.visible[0]
  })

  const ctx = useServerCtx(server)
  const load = useQuery(() => homeSessionQuery(ctx(), server()))
  const actions = useWorkroomActions({ server, ctx })
  // The room whose 「이름 바꾸기·작업실 삭제」 menu is open, from its ⋯ button or a right click.
  const [menu, setMenu] = createSignal<string>()

  const rooms = createMemo(() => {
    const context = ctx()

    if (!context) return []

    return groupWorkrooms(context.projects.list(), homeSessions(context, load.isPending ? [] : (load.data?.() ?? [])))
  })

  // The room holding the tab on screen.
  const here = createMemo(() => {
    const now = current()

    if (!now) return

    if ("directory" in now) return now.directory ? pathKey(now.directory) : undefined

    const room = rooms().find((item) => item.sessions.some((session) => session.id === now.session))

    return room ? pathKey(room.project.worktree) : undefined
  })

  // Rooms the user opened or closed; the others follow the tab on screen.
  const [toggled, setToggled] = createSignal<Record<string, boolean>>({})
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})

  const isOpen = (room: Workroom<LocalProject>) => {
    const key = pathKey(room.project.worktree)

    return toggled()[key] ?? key === here()
  }

  const toggle = (room: Workroom<LocalProject>) => {
    const key = pathKey(room.project.worktree)
    const open = isOpen(room)
    setToggled((all) => ({ ...all, [key]: !open }))
  }

  const openSession = (room: Workroom<LocalProject>, session: SessionInfo) => {
    const conn = server()
    const context = ctx()

    if (!conn || !context) return
    void context.data.session.message.sync(session.id).catch(() => undefined)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
      context.data.session.remember(session)
      context.projects.open(room.project.worktree)
      context.projects.touch(room.project.worktree)
    })
  }

  const newConversation = (room: Workroom<LocalProject>) => {
    const conn = server()
    const context = ctx()

    if (!conn || !context) return
    context.projects.open(room.project.worktree)
    context.projects.touch(room.project.worktree)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory: room.project.worktree })
  }

  const row = "flex h-8 w-full min-w-0 items-center gap-2 rounded-[6px] px-2 text-start text-[13px]"

  const Room = (props: { room: Workroom<LocalProject> }): JSX.Element => {
    const key = () => pathKey(props.room.project.worktree)
    const all = () => expanded()[key()] === true
    const shown = () => (all() ? props.room.sessions : props.room.sessions.slice(0, SHOWN))

    return (
      <div class="flex flex-col gap-0.5">
        <div
          class="group/room relative"
          data-menu={menu() === key()}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu(key())
          }}
        >
          <button
            type="button"
            class={`${row} pe-8 text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover`}
            classList={{ "font-[600]": key() === here() }}
            aria-expanded={isOpen(props.room)}
            title={props.room.project.worktree}
            onClick={() => toggle(props.room)}
          >
            <Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-base" />
            <span class="min-w-0 truncate">{displayName(props.room.project)}</span>
            <Show when={!isOpen(props.room) && props.room.sessions.length > 0}>
              <span class="ms-auto shrink-0 text-[12px] font-[400] text-v2-text-text-faint group-hover/room:invisible group-data-[menu=true]/room:invisible">
                {language.t("jabisu.nav.count", { count: props.room.sessions.length })}
              </span>
            </Show>
          </button>
          <div class="absolute inset-y-0 end-1 flex items-center opacity-0 group-hover/room:opacity-100 group-data-[menu=true]/room:opacity-100 focus-within:opacity-100">
            <Menu
              gutter={4}
              modal={false}
              placement="bottom-end"
              open={menu() === key()}
              onOpenChange={(open) => setMenu(open ? key() : undefined)}
            >
              <Menu.Trigger
                as={IconButton}
                variant="ghost-muted"
                size="small"
                icon={<Icon name="outline-dots" />}
                aria-label={language.t("jabisu.nav.menu")}
              />
              <Menu.Portal>
                <Menu.Content>
                  <Menu.Item onSelect={() => void actions.rename(props.room.project)}>
                    {language.t("jabisu.room.rename")}
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item onSelect={() => void actions.remove(props.room.project)}>
                    {language.t("jabisu.room.delete")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </div>
        </div>
        <Show when={isOpen(props.room)}>
          <div class="ms-[15px] flex flex-col gap-0.5 border-s border-v2-border-border-base ps-2">
            <For each={shown()}>
              {(session) => {
                const active = () => {
                  const now = current()

                  return !!now && "session" in now && now.session === session.id
                }

                return (
                  <button
                    type="button"
                    class={row}
                    classList={{
                      "bg-v2-background-bg-accent/12 font-[600] text-v2-text-text-accent-hover": active(),
                      "text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover": !active(),
                    }}
                    aria-current={active() ? "page" : undefined}
                    onClick={() => openSession(props.room, session)}
                  >
                    <span class="min-w-0 truncate">{sessionLabel(session)}</span>
                  </button>
                )
              }}
            </For>
            <Show when={props.room.sessions.length > SHOWN}>
              <button
                type="button"
                class={`${row} text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover`}
                onClick={() => setExpanded((list) => ({ ...list, [key()]: !all() }))}
              >
                {all()
                  ? language.t("jabisu.nav.less")
                  : language.t("jabisu.nav.more", { count: props.room.sessions.length - SHOWN })}
              </button>
            </Show>
            <button
              type="button"
              class={`${row} text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover`}
              onClick={() => newConversation(props.room)}
            >
              <Icon name="edit" size="small" class="shrink-0" />
              <span class="min-w-0 truncate">{language.t("jabisu.nav.newConversation")}</span>
            </button>
          </div>
        </Show>
      </div>
    )
  }

  return (
    <nav
      aria-label={language.t("jabisu.nav.label")}
      data-component="jabisu-nav"
      class="flex size-full min-h-0 flex-col gap-0.5"
      // The browser's own menu here offers only 「Select All」; a 작업실 opens its own menu instead.
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* 자비수's 「새 작업실」 heads the list in its sun color, the one accent on screen. */}
      <button
        type="button"
        data-action="jabisu-new-workroom"
        class="mb-2 flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-v2-background-bg-contrast text-[14px] font-[700] tracking-[-0.02em] text-v2-text-text-contrast shadow-[var(--v2-elevation-button-contrast)] hover:brightness-125"
        onClick={() => void openWorkroom(current()?.server)}
      >
        <Icon name="plus" size="small" class="shrink-0" />
        <span class="min-w-0 truncate">{language.t("jabisu.workroom.new")}</span>
      </button>
      <NavButton
        icon="magnifying-glass"
        label={language.t("jabisu.nav.search")}
        hint={command.keybind("command.palette")}
        onClick={() => command.trigger("command.palette")}
      />
      {/* 집현전 lives on the desktop's own server, so its command exists only in the desktop app. */}
      <Show when={command.options.some((option) => option.id === JIPHYEONJEON)}>
        <NavButton
          icon="archive"
          label={language.t("jabisu.nav.jiphyeonjeon")}
          onClick={() => command.trigger(JIPHYEONJEON)}
        />
      </Show>
      <div class="mt-4 mb-1 shrink-0 px-2 text-[12px] font-[600] text-v2-text-text-faint">
        {language.t("jabisu.nav.workrooms")}
      </div>
      <div class="-me-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pe-1">
        <For each={rooms()}>{(room) => <Room room={room} />}</For>
        <Show when={ctx() && rooms().length === 0}>
          <p class="px-2 text-[12px] text-v2-text-text-faint">{language.t("jabisu.nav.empty")}</p>
        </Show>
      </div>
      <div class="mt-2 shrink-0 border-t border-v2-border-border-base pt-2">
        <NavButton icon="settings-gear" label={language.t("sidebar.settings")} onClick={() => openSettings()} />
      </div>
    </nav>
  )
}
