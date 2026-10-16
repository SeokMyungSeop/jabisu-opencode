export * as WorktreeGit from "./git.js"

import { Effect } from "effect"
import path from "path"
import { Worktree } from "@opencode/schema/worktree"
import { FSUtil } from "@opencode/util/fs-util"
import { Git } from "../git.js"
import { AbsolutePath } from "../schema.js"
import { canonical, DirectoryUnavailableError } from "./directory.js"
import type { Strategy } from "./strategies.js"

export const make = Effect.gen(function* () {
  const fs = yield* FSUtil.Service
  const git = yield* Git.Service

  /**
   * Copies the source checkout's ignored files that `.worktreeinclude` names, such as `.env`, into a new worktree.
   * The file uses gitignore syntax; matching files that Git tracks or doesn't ignore are already checked out.
   */
  const copyIncluded = Effect.fnUntraced(function* (repository: Git.Repository, directory: AbsolutePath) {
    const patterns = AbsolutePath.make(path.join(repository.worktree, ".worktreeinclude"))
    if (!(yield* fs.isFile(patterns))) return
    const matched = yield* git.index.untracked({ repository, patterns })
    const ignored = yield* git.index.ignored({ repository, paths: matched })
    yield* Effect.forEach(
      matched.filter((file) => ignored.has(file)),
      (file) => {
        const target = path.join(directory, file)
        return fs
          .makeDirectory(path.dirname(target), { recursive: true })
          .pipe(Effect.andThen(fs.copyFile(path.join(repository.worktree, file), target)))
      },
      { concurrency: 8, discard: true },
    )
  })

  return {
    id: Worktree.StrategyID.make("git"),
    create: Effect.fn("Worktree.Git.create")(function* (input) {
      const repository = yield* git.repo.discover(input.sourceDirectory)
      if (!repository) return yield* new DirectoryUnavailableError({ directory: input.sourceDirectory })
      yield* git.worktree.create({
        repository,
        directory: input.directory,
        ref: input.branch,
        branch: input.newBranch,
      })
      // A worktree missing its local files would fail in confusing ways later, so a failed copy removes it again.
      yield* copyIncluded(repository, input.directory).pipe(
        Effect.tapError(() =>
          git.worktree.remove({ repository, directory: input.directory, force: true }).pipe(Effect.ignore),
        ),
      )
      return { directory: yield* canonical(fs, input.directory) }
    }),
    remove: Effect.fn("Worktree.Git.remove")(function* (input) {
      const repository = yield* git.repo.discover(input.directory)
      if (!repository) return yield* new DirectoryUnavailableError({ directory: input.directory })
      yield* git.worktree.remove({ repository, directory: input.directory, force: input.force })
    }),
    list: Effect.fn("Worktree.Git.list")(function* (directory) {
      const repository = yield* git.repo.discover(directory)
      if (!repository) return yield* new DirectoryUnavailableError({ directory })
      const entries = yield* git.worktree.list(repository)
      return yield* Effect.forEach(entries, (entry) =>
        canonical(fs, entry.directory).pipe(
          Effect.map((directory) => ({ directory, type: entry.kind === "main" ? "root" : "worktree" }) as const),
          Effect.catchTag("Worktree.DirectoryUnavailableError", () => Effect.undefined),
        ),
      ).pipe(Effect.map((items) => items.filter((item): item is Worktree.ListEntry => item !== undefined)))
    }),
  } satisfies Strategy
})
