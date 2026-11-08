export * as Permission from "./permission.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { SessionID } from "./session-id.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartingWith("per")).pipe(
  Schema.brand("Permission.ID"),
  Schema.annotate({ identifier: "Permission.ID" }),
  statics((schema) => ({ create: (id?: string) => schema.make(id ?? "per_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Source = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tool"),
    messageID: Schema.String,
    id: Schema.String,
  }),
]).annotate({ identifier: "Permission.Source" })
export type Source = typeof Source.Type

const RequestFields = {
  sessionID: SessionID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  save: Schema.Array(Schema.String).pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  source: Source.pipe(optional),
  message: Schema.String.pipe(optional),
  /** A rule asked for a person to answer, so a client that approves requests on its own leaves this one alone. */
  attended: Schema.Boolean.pipe(optional),
}

export const Request = Schema.Struct({
  id: ID,
  ...RequestFields,
}).annotate({ identifier: "Permission.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Reply = Schema.Literals(["once", "always", "reject"]).annotate({ identifier: "Permission.Reply" })
export type Reply = typeof Reply.Type

const Asked = ephemeral({ type: "permission.asked", schema: Request.fields })
const Replied = ephemeral({
  type: "permission.replied",
  schema: {
    sessionID: SessionID,
    requestID: ID,
    reply: Reply,
  },
})
export const Event = { Asked, Replied, Definitions: inventory(Asked, Replied) }

export const Effect = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "Permission.Effect" })
export type Effect = typeof Effect.Type

export interface Rule extends Schema.Schema.Type<typeof Rule> {}
export const Rule = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
  effect: Effect,
  /**
   * For an ask: a person answers it even where a client approves requests on its own, as for deleting files or
   * changing files outside the project.
   */
  attended: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Permission.Rule" })

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "Permission.Ruleset" })
export type Ruleset = typeof Ruleset.Type
