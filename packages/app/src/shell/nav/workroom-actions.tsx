import { createSignal, Show } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import { isInvalidRequestError } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { displayName } from "@opencode/ui/project-avatar"
import { TextField } from "@opencode/ui/text-field"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import { showToast } from "@/shell/notifications/toast"
import type { LocalProject } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { pathKey } from "@/workspaces/path-key"

// What the server says went wrong with a 작업실, worded for the user.
const PROBLEMS = ["name", "taken", "busy", "in_use", "missing"] as const

type Problem = (typeof PROBLEMS)[number]

const problem = (error: unknown): Problem | undefined => {
  if (!isInvalidRequestError(error)) return
  const kind = error.kind?.replace(/^jabisu_workroom_/, "")

  return PROBLEMS.find((item) => item === kind)
}

const parent = (directory: string) => directory.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "")

/**
 * 「이름 바꾸기」 and 「작업실 삭제」 for a 작업실 in the left list. A 작업실 made with 「새 작업실」 is renamed and thrown away
 * with its folder; a folder the user added from elsewhere only changes its name in the list or leaves the list.
 */
export function useWorkroomActions(input: {
  server: () => ServerConnection.Any | undefined
  ctx: () => ServerCtx | undefined
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const tabs = useTabs()
  const queryClient = useQueryClient()

  const describe = (error: unknown, fallback: string) => {
    const kind = problem(error)

    return kind ? language.t(`jabisu.room.error.${kind}`) : error instanceof Error ? error.message : fallback
  }

  // Whether 「새 작업실」 made the folder, so the server may rename it and the desktop may throw it away.
  const owned = async (project: LocalProject) => {
    const ctx = input.ctx()
    const conn = input.server()

    if (!ctx || !conn || !ServerConnection.local(conn)) return false
    const reply = await ctx.sdk.api.jabisu.workroom.root().catch(() => undefined)

    return !!reply && pathKey(parent(project.worktree)) === pathKey(reply.root)
  }

  // The renamed folder takes the old one's place in the list, and drafts written for it follow it.
  const relocate = (ctx: ServerCtx, conn: ServerConnection.Any, from: string, to: string) => {
    const index = ctx.projects.list().findIndex((item) => pathKey(item.worktree) === pathKey(from))
    const last = ctx.projects.last()

    ctx.projects.remove(from)
    ctx.projects.open(to)

    if (index >= 0) ctx.projects.move(to, index)

    if (last && pathKey(last) === pathKey(from)) ctx.projects.touch(to)

    for (const tab of tabs.store)
      if (tab.type === "draft" && tab.directory && pathKey(tab.directory) === pathKey(from))
        tabs.updateDraft(tab.draftID, { directory: to })

    void queryClient.invalidateQueries({ queryKey: ["home-sessions", conn] })
  }

  const renameFolder = async (project: LocalProject, name: string) => {
    const ctx = input.ctx()
    const conn = input.server()

    if (!ctx || !conn) return
    const renamed = await ctx.sdk.api.jabisu.workroom.rename({ directory: project.worktree, name })
    relocate(ctx, conn, project.worktree, renamed.directory)
  }

  // Same as the project settings: a project the server knows keeps its name there, any other one in the app.
  const renameInList = async (project: LocalProject, name: string) => {
    const ctx = input.ctx()

    if (!ctx) return

    if (project.id && project.id !== "global") {
      ctx.sync.project.update(await ctx.sdk.api.project.update({ projectID: project.id, name }))

      return
    }

    ctx.sync.project.meta(project.worktree, { name })
  }

  function RenameDialog(props: { project: LocalProject; owned: boolean }) {
    const [name, setName] = createSignal(displayName(props.project))
    const [error, setError] = createSignal<string>()
    const [saving, setSaving] = createSignal(false)

    const save = async (event?: SubmitEvent) => {
      event?.preventDefault()
      const next = name().trim()

      if (!next || next === displayName(props.project)) return dialog.close()
      setSaving(true)
      setError(undefined)
      await (props.owned ? renameFolder(props.project, next) : renameInList(props.project, next))
        .then(() => dialog.close())
        .catch((cause: unknown) => setError(describe(cause, language.t("jabisu.room.failed.rename"))))
        .finally(() => setSaving(false))
    }

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("jabisu.room.rename.title")}
            description={language.t(props.owned ? "jabisu.room.rename.owned" : "jabisu.room.rename.listOnly")}
          />
        </DialogHeader>
        <form onSubmit={(event) => void save(event)}>
          <DialogBody class="px-5 pb-2">
            <TextField
              autofocus
              label={language.t("jabisu.room.rename.label")}
              value={name()}
              onChange={(value) => {
                setName(value)
                setError(undefined)
              }}
              validationState={error() ? "invalid" : undefined}
              error={error()}
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" variant="contrast" disabled={saving() || !name().trim()}>
              {language.t("jabisu.room.rename.save")}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    )
  }

  // Leaves the list; a draft written for the folder closes with it.
  const leave = (ctx: ServerCtx, project: LocalProject) => {
    ctx.projects.close(project.worktree)

    // From the end, so closing one leaves the others' places unchanged.
    for (let index = tabs.store.length - 1; index >= 0; index--) {
      const tab = tabs.store[index]

      if (tab?.type === "draft" && tab.directory && pathKey(tab.directory) === pathKey(project.worktree))
        tabs.closeTab(index)
    }
  }

  function DeleteDialog(props: { project: LocalProject; owned: boolean }) {
    const [busy, setBusy] = createSignal(false)
    // The recycle bin is the desktop's; a folder on another computer only leaves the list.
    const trash = () => props.owned && !!platform.trashWorkroom

    const keep = () => {
      const ctx = input.ctx()

      if (ctx) leave(ctx, props.project)
      dialog.close()
    }

    const fail = (description: string) =>
      showToast({ variant: "error", title: language.t("jabisu.room.failed.delete"), description })

    // The server first stops what it runs in the folder and refuses while the AI works there; then the desktop moves
    // the folder to the recycle bin, which fails while a file in it is open.
    const throwAway = async () => {
      const ctx = input.ctx()
      const bin = platform.trashWorkroom

      if (!ctx || !bin) return
      setBusy(true)

      const released = await ctx.sdk.api.jabisu.workroom.release({ directory: props.project.worktree }).then(
        () => true,
        (cause: unknown) => {
          fail(describe(cause, language.t("jabisu.room.failed.delete")))

          return false
        },
      )

      const trashed = released ? await bin(props.project.worktree).catch(() => undefined) : false

      setBusy(false)

      if (!released) return

      if (trashed === undefined) return fail(language.t("jabisu.room.error.in_use"))

      if (!trashed) return fail(language.t("jabisu.room.error.missing"))

      leave(ctx, props.project)
      dialog.close()
    }

    const description = () => {
      if (trash()) return language.t("jabisu.room.delete.owned")

      return language.t(props.owned ? "jabisu.room.delete.kept" : "jabisu.room.delete.listOnly")
    }

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("jabisu.room.delete.title", { name: displayName(props.project) })}
            description={description()}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Show
            when={trash()}
            fallback={
              <Button variant="danger" onClick={keep}>
                {language.t("jabisu.room.delete.confirm")}
              </Button>
            }
          >
            <Button variant="neutral" disabled={busy()} onClick={keep}>
              {language.t("jabisu.room.delete.keepFolder")}
            </Button>
            <Button variant="danger" disabled={busy()} onClick={() => void throwAway()}>
              {language.t("jabisu.room.delete.withFolder")}
            </Button>
          </Show>
        </DialogFooter>
      </Dialog>
    )
  }

  return {
    rename: async (project: LocalProject) => {
      const made = await owned(project)
      void dialog.show(() => <RenameDialog project={project} owned={made} />)
    },
    remove: async (project: LocalProject) => {
      const made = await owned(project)
      void dialog.show(() => <DeleteDialog project={project} owned={made} />)
    },
  }
}
