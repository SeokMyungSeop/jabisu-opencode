import { JABISU } from "@opencode/ui/logo"
import type { ServerCtx } from "@/runtime/server/runtime"

export function addProjects(context: ServerCtx, directories: string[]) {
  const directory = directories[0]

  if (!directory) return

  directories.forEach((item) => {
    if (context.projects.list().some((project) => project.worktree === item)) return
    const location = { directory: item }
    void context.sdk.api.file
      .list({ path: ".", location })
      .then(() => context.sdk.api.location.get({ location }))
      .then((value) => context.sync.child(item, { bootstrap: false })[1]("project", value.project.id))
      // A 작업실 folder brought from another PC may carry its conversations; 자비수 reads them in as it is added.
      .then(() => (JABISU ? context.sdk.api.jabisu.workroom.unpack({ directory: item }) : undefined))
      .catch(() => undefined)
    context.projects.open(item)
  })
  context.projects.touch(directory)

  return directory
}
