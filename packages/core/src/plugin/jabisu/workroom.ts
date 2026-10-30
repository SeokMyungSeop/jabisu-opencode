export * as Workroom from "./workroom.js"

import path from "path"
import { Effect, Schedule, Schema } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import type { FSUtil } from "@opencode/util/fs-util"
import type { Global } from "@opencode/util/global"
import type { Session } from "../../session.js"

// 자비수 작업실: 「새 작업실」 opens a conversation in `<Documents>/자비수 작업실`, and when its first message is sent the
// folder the conversation works in is made there, named after the message's first attached file or, without one,
// after the request itself. The folder is made only once its name is known, so it is never renamed behind a
// conversation's back. The user may rename it later, while no conversation works in it, and its conversations
// follow it; folders the user added from elsewhere are never renamed or thrown away.

export const ROOT = "자비수 작업실"
// The name shown until the first message, and the folder name when nothing better can be read from the message.
export const FALLBACK = "새 작업실"
const MAX_LENGTH = 40
// A name the user types may be longer than one read from a message.
const TYPED_LENGTH = 60

export class WorkroomError extends Schema.TaggedError<WorkroomError>()("Workroom.WorkroomError", {
  reason: Schema.String,
  // What went wrong in terms the user can act on; the app words each one.
  kind: Schema.optional(Schema.Literals(["name", "taken", "busy", "in_use", "not_owned", "missing"])),
}) {}

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Global.Interface
}

/** The folder that holds every 작업실 made with 「새 작업실」. */
export const root = (global: Pick<Global.Interface, "home">) => path.join(global.home, "Documents", ROOT)

const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b)

/** Whether a folder is one 「새 작업실」 made, directly inside the 작업실 folder. */
export function owned(global: Pick<Global.Interface, "home">, directory: string) {
  return same(path.dirname(path.resolve(directory)), root(global))
}

const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
// Recorders name files by date and time, as in 「음성 261028_100642_초광역특구 설명회 참석」.
const RECORDER = /^(?:음성|녹음|통화\s*녹음|recording|voice)?[\s_-]*\d{6,8}[\s_-]+\d{4,6}(?:[\s_-]+|$)/i
// A request ends in the verb asking for it, whatever the verb, as in 「… 만들어 줘」, 「… 지어줘」 or 「… 정리해 주세요」.
const REQUEST = /\s*[가-힣]+\s*(?:줘|줘요|주세요|줄래|줄래요|주실래요|주십시오|주시겠어요)\s*[.!?~]*$/
// Words that say how much or how, left before the verb: 「제목 하나만 지어 줘」, 「요약 좀 해 줘」.
const MANNER = /(?:\s+(?:하나만|한\s*개만|두\s*개만|좀|간단히|짧게|빨리|자세히|다시|같이))+$/
const LEADING = /^(?:이|그|저|위|아래|다음)\s+/
const OBJECT = /(?:을|를)$/

/** A folder name from free text: no characters Windows forbids, at most 40 characters cut at a space. */
function clean(text: string) {
  const plain = text.replace(INVALID, " ").replace(/\s+/g, " ").trim()
  const cut =
    plain.length <= MAX_LENGTH ? plain : plain.slice(0, MAX_LENGTH).replace(/\s+\S*$/, "") || plain.slice(0, MAX_LENGTH)
  const trimmed = cut.replace(/[.\s]+$/, "").replace(/^\.+/, "")
  if (trimmed.length < 2 || RESERVED.test(trimmed)) return undefined
  return trimmed
}

/**
 * What a request is about: its first sentence without the closing verb, the object particle and a leading pointer.
 * The request comes first, as in 「출장 메모 정리해 줘. 메모는 이 폴더에 둬.」
 */
function topic(text: string) {
  const line =
    text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) ?? ""
  const sentence = line.split(/(?<=[.!?。])\s+/)[0] ?? line
  return sentence.replace(REQUEST, "").replace(MANNER, "").replace(OBJECT, "").replace(LEADING, "")
}

/** The name of a new 작업실: the first attached file's name without a recorder's date, else the request's topic. */
export function name(input: { readonly text: string; readonly files: readonly string[] }) {
  const file = input.files
    .map((item) => clean(path.parse(item).name.replace(RECORDER, "")))
    .find((item) => item !== undefined)
  return file ?? clean(topic(input.text)) ?? FALLBACK
}

/** Makes the folder that holds every 작업실, so a new conversation can open there. */
export const ensureRoot = Effect.fn("Workroom.ensureRoot")(function* (deps: Dependencies) {
  const directory = root(deps.global)
  yield* deps.fs
    .ensureDir(directory)
    .pipe(Effect.mapError(() => new WorkroomError({ reason: `${directory} cannot be made` })))
  return directory
})

/** Makes a new 작업실 named after the first message, adding (2), (3) … when that name is taken. */
export const create = Effect.fn("Workroom.create")(function* (
  deps: Dependencies,
  input: { readonly text: string; readonly files: readonly string[] },
) {
  const parent = yield* ensureRoot(deps)
  const base = name(input)
  for (let index = 1; index <= 99; index++) {
    const candidate = index === 1 ? base : `${base} (${index})`
    const directory = path.join(parent, candidate)
    if (yield* deps.fs.existsSafe(directory)) continue
    yield* deps.fs
      .ensureDir(directory)
      .pipe(Effect.mapError(() => new WorkroomError({ reason: `${directory} cannot be made` })))
    return { directory, name: candidate }
  }
  return yield* new WorkroomError({ reason: `${base} and 98 numbered copies already exist in ${parent}` })
})

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/

/** A name the user typed for a 작업실, as Windows takes it for a folder: without trailing dots and spaces. */
export function typed(text: string) {
  const name = text.trim().replace(/[.\s]+$/, "")
  if (!name || name.startsWith(".") || FORBIDDEN.test(name) || RESERVED.test(name) || name.length > TYPED_LENGTH)
    return undefined
  return name
}

type Conversation = Session.Info

export interface RenameDependencies extends Dependencies {
  /** The conversations, which follow a renamed 작업실; one working now keeps its 작업실 as it is until it stops. */
  readonly sessions: Pick<Session.Interface, "list" | "move" | "active">
  /** Shuts down what the server runs in a folder, such as MCP servers, which keep the folder open on Windows. */
  readonly release: (directory: string) => Effect.Effect<void>
}

// Every conversation held in a folder, archived ones too.
const held = Effect.fnUntraced(function* (deps: RenameDependencies, directory: string) {
  const found: Conversation[] = []
  let page = yield* deps.sessions.list({ directory: AbsolutePath.make(directory), limit: 100 }).pipe(Effect.orDie)
  for (;;) {
    found.push(...page.data)
    const next = page.cursor.next
    if (!next || page.data.length === 0) return found
    page = yield* deps.sessions.list({ cursor: next, limit: 100 }).pipe(Effect.orDie)
  }
})

/**
 * Readies a 작업실 made with 「새 작업실」 to be renamed or thrown away: no conversation in it is working, and nothing
 * the server ran for it still holds the folder open. Returns the conversations held in it.
 */
export const release = Effect.fn("Workroom.release")(function* (deps: RenameDependencies, directory: string) {
  const folder = path.resolve(directory)
  if (!owned(deps.global, folder))
    return yield* new WorkroomError({ kind: "not_owned", reason: `${folder} is not in ${root(deps.global)}` })
  if (!(yield* deps.fs.isDir(folder))) return yield* new WorkroomError({ kind: "missing", reason: `${folder} is gone` })
  const conversations = yield* held(deps, folder)
  const working = yield* deps.sessions.active
  const busy = conversations.find((conversation) => working.has(conversation.id))
  if (busy) return yield* new WorkroomError({ kind: "busy", reason: `${busy.id} is working in ${folder}` })
  yield* deps.release(folder)
  return conversations
})

/** Renames a 작업실 made with 「새 작업실」, its folder too, and moves its conversations along. */
export const rename = Effect.fn("Workroom.rename")(function* (
  deps: RenameDependencies,
  input: { readonly directory: string; readonly name: string },
) {
  const folder = path.resolve(input.directory)
  const name = typed(input.name)
  if (!name) return yield* new WorkroomError({ kind: "name", reason: `${input.name} cannot name a folder` })
  const target = path.join(path.dirname(folder), name)
  if (target === folder) return { directory: folder, name }
  // A change of letter case alone names the same folder on Windows.
  if (!same(target, folder) && (yield* deps.fs.existsSafe(target)))
    return yield* new WorkroomError({ kind: "taken", reason: `${target} already exists` })
  const conversations = yield* release(deps, folder)
  // Programs the server stopped may take a moment to let go of the folder; a file open in another program does not.
  yield* deps.fs.rename(folder, target).pipe(
    Effect.retry({ times: 12, schedule: Schedule.spaced("250 millis") }),
    Effect.mapError(() => new WorkroomError({ kind: "in_use", reason: `${folder} is open in another program` })),
  )
  // The old folder is gone, so each move applies at once.
  yield* Effect.forEach(
    conversations,
    (conversation) =>
      deps.sessions
        .move({ sessionID: conversation.id, directory: AbsolutePath.make(target) })
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("workroom conversation did not move", { conversation, cause })),
        ),
    { discard: true },
  )
  return { directory: target, name }
})
