export * as ConfigWorktree from "./worktree.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export const Info = Schema.Struct({
  directory: optional(Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()))).annotate({
    description: "Parent directory for new worktrees, relative to the project's primary checkout when not absolute",
  }),
  branch_prefix: optional(Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()))).annotate({
    description:
      "Create a branch named with this prefix followed by the worktree's name for each new worktree. Without it, worktrees are created detached.",
  }),
}).annotate({ identifier: "Config.Worktree" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
