import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { ScrollView } from "@opencode/ui/scroll-view"
import { containsDirectory, getFilename } from "@opencode/util/path"
import { createMemo, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useExtension, type Project, type MountedSession } from "../sdk"
import type Details from "./index"
import { workspaceDirectories } from "./paths"
import { ProjectDetailsCard } from "./project-card"
import { SessionServerPanel } from "./server-panel"
import { SessionWorkspaceMenu } from "./workspace-menu"

export type Disclosure = {
  project(): boolean
  server(): boolean
  setProject(expanded: boolean): void
  setServer(expanded: boolean): void
}

export type DetailsPanelProps = {
  session: MountedSession
  project: Project
  shown?: boolean
  mobile?: boolean
  /** Fills the side region instead of the popover's fixed width. */
  side?: boolean
  diffs?: readonly { additions: number; deletions: number }[]
  moveDismissed: boolean
  onMoveDismiss: () => void
  /** Absent while the review extension is disabled, which also leaves `diffs` undefined. */
  onReview?: () => void
  /** Moves the details into the side region; absent where they already show there or cannot. */
  onPin?: () => void
  disclosure: Disclosure
}

export default function SessionDetailsPanel(props: DetailsPanelProps) {
  const ctx = useExtension<typeof Details>()
  const locale = ctx.locale
  const data = () => props.session.server.data

  // The context card shows while the context extension is active.
  const usage = () => {
    const live = ctx.uses.usage()

    return live.status === "active" ? live.value : undefined
  }

  const placement = createMemo(() =>
    props.mobile ? "top-end" : locale.direction() === "rtl" ? "right-start" : "left-start",
  )

  const location = () => {
    if (props.session.local) return ctx.t("workspace.local")

    const workspace = workspaceDirectories(props.project).find((item) =>
      containsDirectory(item, props.session.directory),
    )

    return getFilename(workspace ?? props.session.directory)
  }

  // A subagent shares its parent's workspace, so it shows where it runs but cannot move on its own.
  const subagent = () => !!data().session.get(props.session.id)?.parentID

  const workspace = () => (
    <>
      <Icon name={props.session.local ? "monitor" : "outline-worktree"} class="shrink-0 text-v2-icon-icon-muted" />
      <span dir="auto" class="session-summary-label">
        {location()}
      </span>
    </>
  )

  const branch = () => data().location.vcs.info({ directory: props.session.directory })?.branch.current
  const baseBranch = () => data().location.vcs.info({ directory: props.project.worktree })?.branch.current

  const content = (
    <div
      data-component="session-summary-panel"
      data-mobile={props.mobile || undefined}
      data-side={props.side || undefined}
    >
      <div>
        <ProjectDetailsCard
          project={props.project}
          expanded={props.disclosure.project()}
          onExpandedChange={props.disclosure.setProject}
        >
          <Show when={!subagent()} fallback={<div class="session-summary-row">{workspace()}</div>}>
            <SessionWorkspaceMenu
              session={props.session}
              project={props.project}
              directory={props.session.directory}
              placement={placement()}
              class="session-summary-row"
            >
              {workspace()}
              <Icon name="fill-triangle-down" class="session-summary-menu-indicator shrink-0 text-v2-icon-icon-muted" />
            </SessionWorkspaceMenu>
          </Show>
          <div class="session-summary-row">
            <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
            <Show
              when={branch()}
              fallback={
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="shrink-0 whitespace-nowrap">{ctx.t("noBranch")}</span>
                  <Show when={baseBranch()}>
                    {(base) => (
                      <>
                        <span class="text-v2-text-text-muted">·</span>
                        <span class="truncate text-v2-text-text-faint">{ctx.t("basedOn", { branch: base() })}</span>
                      </>
                    )}
                  </Show>
                </span>
              }
            >
              <span dir="auto" class="min-w-0 truncate">
                {branch()}
              </span>
            </Show>
          </div>
          <Show when={props.onReview}>
            <button type="button" class="session-summary-row" onClick={() => props.onReview?.()}>
              <Icon name="review" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="session-summary-label flex items-center gap-2">
                <Show
                  when={props.diffs}
                  fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("loadingChanges")}</span>}
                >
                  {(diffs) => (
                    <Show
                      when={diffs().length > 0}
                      fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("noChanges")}</span>}
                    >
                      <span class="min-w-0 truncate">{ctx.plural("ui.sessionTurn.diffs.changed", diffs().length)}</span>
                      <span class="shrink-0 text-v2-text-text-muted">·</span>
                      <DiffChanges appearance="standard" changes={[...diffs()]} />
                    </Show>
                  )}
                </Show>
              </span>
            </button>
          </Show>
        </ProjectDetailsCard>
        <Show
          when={
            !subagent() &&
            props.disclosure.project() &&
            props.session.local &&
            props.diffs?.length &&
            !props.moveDismissed
          }
        >
          <div class="session-summary-move">
            <SessionWorkspaceMenu
              session={props.session}
              project={props.project}
              directory={props.session.directory}
              placement={placement()}
              class="session-summary-row"
            >
              <Icon name="outline-worktree" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="min-w-0 truncate">{ctx.t("move.title")}</span>
            </SessionWorkspaceMenu>
            <button
              type="button"
              class="session-summary-dismiss"
              aria-label={ctx.t("common.dismiss")}
              onClick={props.onMoveDismiss}
            >
              <Icon name="xmark-small" />
            </button>
          </div>
        </Show>
      </div>
      <Show when={usage()}>
        {(usage) => (
          <section class="session-summary-card" data-section="context">
            <div class="session-summary-row session-summary-heading">
              <Icon name="status" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="session-summary-label">{ctx.t("context")}</span>
            </div>
            <Dynamic component={usage().Summary} session={props.session} />
          </section>
        )}
      </Show>
      <SessionServerPanel
        session={props.session}
        directory={props.session.directory}
        shown={props.shown !== false}
        mobile={props.mobile}
        expanded={props.disclosure.server()}
        onExpandedChange={props.disclosure.setServer}
      />
      <Show when={props.onPin}>
        {(pin) => (
          <section class="session-summary-card">
            <button type="button" class="session-summary-row" onClick={() => pin()()}>
              <Icon name="sidebar-right" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="session-summary-label">{ctx.t("panel.open")}</span>
            </button>
          </section>
        )}
      </Show>
    </div>
  )

  // The popover and the drawer scroll themselves; the side tab fills the region and scrolls its own content.
  return (
    <Show when={props.side} fallback={content}>
      <ScrollView class="h-full">
        <div class="p-3">{content}</div>
      </ScrollView>
    </Show>
  )
}
