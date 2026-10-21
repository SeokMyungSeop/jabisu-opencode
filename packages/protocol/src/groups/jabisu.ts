import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

// 자비수: settings and 집현전 folders the app shows for features the engine owns.

export const JabisuTranscription = Schema.Struct({
  enabled: Schema.Boolean,
  model: Schema.String,
  defaultModel: Schema.String,
  // An OpenRouter key is available, so transcription can be turned on.
  openrouter: Schema.Boolean,
}).annotate({ identifier: "JabisuTranscription" })
export type JabisuTranscription = typeof JabisuTranscription.Type

export const Jiphyeonjeon = Schema.Struct({
  name: Schema.String,
  directory: Schema.String,
  // The user's own instructions, under the fixed rules in the folder's AGENTS.md.
  instructions: Schema.String,
  // Files under its sources folder, relative to it with `/`.
  sources: Schema.Array(Schema.String),
}).annotate({ identifier: "Jiphyeonjeon" })
export type Jiphyeonjeon = typeof Jiphyeonjeon.Type

export const JiphyeonjeonList = Schema.Struct({
  root: Schema.String,
  items: Schema.Array(Jiphyeonjeon),
  // An OpenRouter key is available, so instructions can be suggested with `suggestModel` there.
  openrouter: Schema.Boolean,
  suggestModel: Schema.String,
}).annotate({ identifier: "JiphyeonjeonList" })

export const JiphyeonjeonSource = Schema.Struct({
  path: Schema.String,
  // `pending` is a recording not transcribed yet, `unsupported` neither text nor a document, `unreadable` a document
  // that could not be converted, with `reason` saying why.
  status: Schema.Literals(["ready", "pending", "unsupported", "unreadable"]),
  reason: Schema.optional(Schema.String),
}).annotate({ identifier: "JiphyeonjeonSource" })
export type JiphyeonjeonSource = typeof JiphyeonjeonSource.Type

const NameQuery = Schema.Struct({ ...LocationQuery.fields, name: Schema.String })

export const JabisuGroup = HttpApiGroup.make("server.jabisu")
  .add(
    HttpApiEndpoint.get("jabisu.transcription.get", "/api/jabisu/transcription", {
      query: LocationQuery,
      success: JabisuTranscription,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.transcription.get",
          summary: "Get audio transcription settings",
          description:
            "Return whether recordings read as transcripts, the model used, and whether OpenRouter is connected.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("jabisu.transcription.update", "/api/jabisu/transcription", {
      query: LocationQuery,
      payload: Schema.Struct({ enabled: Schema.Boolean, model: Schema.optional(Schema.String) }),
      success: JabisuTranscription,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.transcription.update",
          summary: "Update audio transcription settings",
          description:
            "Turn transcription on or off and choose its model. Turning it on needs an OpenRouter connection.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("jabisu.jiphyeonjeon.list", "/api/jabisu/jiphyeonjeon", {
      query: LocationQuery,
      success: JiphyeonjeonList,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.jiphyeonjeon.list",
          summary: "List 집현전",
          description: "Return the folder that holds every 집현전 and each one's instructions and sources.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.jiphyeonjeon.create", "/api/jabisu/jiphyeonjeon", {
      query: LocationQuery,
      payload: Schema.Struct({ name: Schema.String }),
      success: Jiphyeonjeon,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.jiphyeonjeon.create",
          summary: "Create a 집현전",
          description: "Make a 집현전 folder with an empty sources folder and the rules for answering from it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("jabisu.jiphyeonjeon.instruct", "/api/jabisu/jiphyeonjeon/instructions", {
      query: LocationQuery,
      payload: Schema.Struct({ name: Schema.String, instructions: Schema.String }),
      success: Jiphyeonjeon,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.jiphyeonjeon.instruct",
          summary: "Set a 집현전's instructions",
          description: "Replace the user's instructions of a 집현전, keeping the rules above them current.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("jabisu.jiphyeonjeon.sources", "/api/jabisu/jiphyeonjeon/sources", {
      query: NameQuery,
      success: Schema.Array(JiphyeonjeonSource),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.jiphyeonjeon.sources",
          summary: "List a 집현전's sources",
          description: "Return each source of a 집현전 with whether its search can read it, and why not.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.jiphyeonjeon.suggest", "/api/jabisu/jiphyeonjeon/suggest", {
      query: LocationQuery,
      // `openrouter`: the user agreed to send the sources' beginnings to OpenRouter's `suggestModel`; otherwise the
      // default model writes them.
      payload: Schema.Struct({ name: Schema.String, openrouter: Schema.optional(Schema.Boolean) }),
      success: Schema.Struct({ instructions: Schema.String }),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.jiphyeonjeon.suggest",
          summary: "Suggest a 집현전's instructions",
          description:
            "Write instructions in P-C-T-F form from the 집현전's sources, with OpenRouter when asked or else the default model, without saving them.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "jabisu", description: "자비수 routes." }))
