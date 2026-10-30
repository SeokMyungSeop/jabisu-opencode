import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
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
  // PDF pages (from 1) of a searchable source that have no text, probably scanned images, so search skips them.
  blank: Schema.optional(Schema.Array(Schema.Number)),
}).annotate({ identifier: "JiphyeonjeonSource" })
export type JiphyeonjeonSource = typeof JiphyeonjeonSource.Type

const NameQuery = Schema.Struct({ ...LocationQuery.fields, name: Schema.String })

// `default`: no copy of the user's; `custom`: the user's copy of the current version, which replaces the bundled
// skill; `changed`: the user's copy of an older version of a bundled skill that has changed since.
export const JabisuSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  status: Schema.Literals(["default", "custom", "changed"]),
  // Whether the model is offered the skill; one that is off stays installed and is suggested when a request needs it.
  on: Schema.Boolean,
  // The Korean name, summary and search words 자비수 gives it.
  title: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  // The user's copy, when there is one.
  directory: Schema.optional(Schema.String),
}).annotate({ identifier: "JabisuSkill" })
export type JabisuSkill = typeof JabisuSkill.Type

export const JabisuSkillList = Schema.Struct({
  // The user's skills folder, where copies go and updates never write.
  folder: Schema.String,
  // Where copies the user stopped using are moved.
  backups: Schema.String,
  skills: Schema.Array(JabisuSkill),
}).annotate({ identifier: "JabisuSkillList" })
export type JabisuSkillList = typeof JabisuSkillList.Type

const SkillName = Schema.Struct({ name: Schema.String })

// A folder the work index follows, with how much of it the index holds: its files, the documents among them, and how
// many documents' text is indexed or still waiting.
export const JabisuWorkFolder = Schema.Struct({
  path: Schema.String,
  files: Schema.Number,
  documents: Schema.Number,
  ready: Schema.Number,
  pending: Schema.Number,
}).annotate({ identifier: "JabisuWorkFolder" })
export type JabisuWorkFolder = typeof JabisuWorkFolder.Type

// The folders the user chooses, by what they hold.
const JabisuWorkChoice = Schema.Struct({
  // Where received files land, such as the downloads folder and messenger folders.
  received: Schema.Array(Schema.String),
  // Where the user files their work.
  saved: Schema.Array(Schema.String),
})

export const JabisuWork = Schema.Struct({
  // 자비수's own work folder, always indexed; it holds the work profile.
  jabisu: JabisuWorkFolder,
  received: Schema.Array(JabisuWorkFolder),
  saved: Schema.Array(JabisuWorkFolder),
  // Received-file folders on this PC the app offers to add: the downloads folder and messenger folders.
  candidates: Schema.Array(Schema.Struct({ path: Schema.String, kind: Schema.Literals(["downloads", "messenger"]) })),
  // The user's work profile file, which every session reads as instructions.
  profile: Schema.Struct({ path: Schema.String, exists: Schema.Boolean }),
}).annotate({ identifier: "JabisuWork" })
export type JabisuWork = typeof JabisuWork.Type

// The key for 법제처's law database that the law tools use; the key itself stays on the server.
export const JabisuLaw = Schema.Struct({
  configured: Schema.Boolean,
  // The saved key with most of it hidden, for the user to recognise it.
  masked: Schema.optional(Schema.String),
  // Where the user applies for a key.
  apply: Schema.String,
}).annotate({ identifier: "JabisuLaw" })
export type JabisuLaw = typeof JabisuLaw.Type

// The folder 「새 작업실」 opens a conversation in, before its first message makes the 작업실 itself.
export const JabisuWorkroomRoot = Schema.Struct({ root: Schema.String }).annotate({ identifier: "JabisuWorkroomRoot" })
export type JabisuWorkroomRoot = typeof JabisuWorkroomRoot.Type

// A 작업실 made for a conversation's first message.
export const JabisuWorkroom = Schema.Struct({ directory: Schema.String, name: Schema.String }).annotate({
  identifier: "JabisuWorkroom",
})
export type JabisuWorkroom = typeof JabisuWorkroom.Type

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
  .add(
    HttpApiEndpoint.get("jabisu.skills.list", "/api/jabisu/skills", {
      query: LocationQuery,
      success: JabisuSkillList,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.skills.list",
          summary: "List bundled skills",
          description: "Return each bundled skill and whether the user's own copy replaces it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.skills.copy", "/api/jabisu/skills/copy", {
      query: LocationQuery,
      payload: SkillName,
      success: JabisuSkillList,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.skills.copy",
          summary: "Copy a bundled skill",
          description: "Copy a bundled skill into the user's skills folder, where it replaces the bundled one.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.skills.keep", "/api/jabisu/skills/keep", {
      query: LocationQuery,
      payload: SkillName,
      success: JabisuSkillList,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.skills.keep",
          summary: "Keep a copied skill",
          description: "Keep the user's copy after its bundled skill changed, so the change is not offered again.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.skills.reset", "/api/jabisu/skills/reset", {
      query: LocationQuery,
      payload: SkillName,
      success: Schema.Struct({ backup: Schema.String, list: JabisuSkillList }),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.skills.reset",
          summary: "Use a bundled skill again",
          description: "Move the user's copy of a bundled skill into the backup folder, so the bundled one is used.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.skills.turn", "/api/jabisu/skills/turn", {
      query: LocationQuery,
      payload: Schema.Struct({ name: Schema.String, on: Schema.Boolean }),
      success: JabisuSkillList,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.skills.turn",
          summary: "Turn a bundled skill on or off",
          description: "Choose whether the model is offered a bundled skill in every chat from now.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("jabisu.work.get", "/api/jabisu/work", {
      query: LocationQuery,
      success: JabisuWork,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.work.get",
          summary: "Get the work assistant's folders",
          description:
            "Return 자비수's work folder and the chosen received-file and saved-work folders with their index coverage, folders to suggest, and the work profile.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("jabisu.work.update", "/api/jabisu/work", {
      query: LocationQuery,
      payload: JabisuWorkChoice,
      success: JabisuWork,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.work.update",
          summary: "Choose the work folders",
          description:
            "Replace the received-file and saved-work folders the work index follows; each must be an existing folder.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("jabisu.law.get", "/api/jabisu/law", {
      query: LocationQuery,
      success: JabisuLaw,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.law.get",
          summary: "Get the law database key",
          description: "Return whether a key for 법제처's law database is saved, and where to apply for one.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("jabisu.law.update", "/api/jabisu/law", {
      query: LocationQuery,
      payload: Schema.Struct({ key: Schema.String }),
      success: JabisuLaw,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.law.update",
          summary: "Save the law database key",
          description:
            "Check the key with one search of 법제처's law database and save it; an empty key removes the saved one.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("jabisu.workroom.root", "/api/jabisu/workroom", {
      query: LocationQuery,
      success: JabisuWorkroomRoot,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.workroom.root",
          summary: "Get the 작업실 folder",
          description: "Make, if needed, and return the folder that holds every 작업실 made with 「새 작업실」.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.workroom.create", "/api/jabisu/workroom", {
      query: LocationQuery,
      payload: Schema.Struct({ text: Schema.String, files: Schema.Array(Schema.String) }),
      success: JabisuWorkroom,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.workroom.create",
          summary: "Make a 작업실",
          description:
            "Make a 작업실 folder named after a conversation's first message: its first attached file, else its request.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.workroom.rename", "/api/jabisu/workroom/rename", {
      query: LocationQuery,
      payload: Schema.Struct({ directory: Schema.String, name: Schema.String }),
      success: JabisuWorkroom,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.workroom.rename",
          summary: "Rename a 작업실",
          description:
            "Rename a 작업실 made with 「새 작업실」, its folder too, and move its conversations to the renamed folder. Fails while one of them is working or a file in the folder is open in another program.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("jabisu.workroom.release", "/api/jabisu/workroom/release", {
      query: LocationQuery,
      payload: Schema.Struct({ directory: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "jabisu.workroom.release",
          summary: "Ready a 작업실 to be thrown away",
          description:
            "Stop what the server runs in a 작업실 made with 「새 작업실」, so the app can move its folder to the recycle bin. Fails while one of its conversations is working.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "jabisu", description: "자비수 routes." }))
