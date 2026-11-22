export * as Carry from "./carry.js"

import path from "path"
import { Effect, Schema } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionTransfer as Transfer } from "@opencode/schema/session-transfer"
import type { FSUtil } from "@opencode/util/fs-util"
import type { Session } from "../../session.js"
import type { SessionTransfer } from "../../session/transfer.js"

// 자비수 keeps conversations in its own database, not in the 작업실 folder, so a folder zipped and opened on another PC
// arrives without them. 「대화 담기」 writes a 작업실's conversations into the folder, one file each, and the folder
// brings them along: the 자비수 that adds it reads them in. Nothing is written until the user asks, because a folder
// handed to someone else would otherwise carry what was said to the AI without the user knowing.

/** Where a 작업실 keeps its packed conversations, under its own folder. */
export const folder = (directory: string) => path.join(directory, ".jabisu", "대화")

const NOTE = "읽어 보세요.txt"

const note = [
  "이 폴더에는 자비수에서 이 작업실로 나눈 대화가 들어 있습니다.",
  "작업실 메뉴의 「대화 담기」를 눌렀을 때만 만들어지고, 다른 PC의 자비수가 이 작업실을 열 때 대화를 되살리는 데 씁니다.",
  "이 작업실 폴더를 남에게 보내면 대화도 함께 갑니다. 대화를 보내고 싶지 않으면 이 「.jabisu」 폴더를 지우고 보내세요.",
  "",
].join("\r\n")

const encode = Schema.encodeSync(Schema.fromJsonString(Transfer.Data))
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Transfer.Data))

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly sessions: Pick<Session.Interface, "list">
  readonly transfer: SessionTransfer.Interface
}

export class CarryError extends Schema.TaggedError<CarryError>()("Carry.CarryError", { reason: Schema.String }) {}

// Every conversation held in the folder, the ones a conversation started included.
const held = Effect.fnUntraced(function* (deps: Pick<Dependencies, "sessions">, directory: string) {
  const first = yield* deps.sessions.list({ directory: AbsolutePath.make(directory), order: "asc", limit: 200 })
  const all = [...first.data]
  let next = first.cursor.next

  while (next) {
    const page = yield* deps.sessions.list({ cursor: next, limit: 200 })
    all.push(...page.data)
    next = page.cursor.next
  }

  return all
})

const files = Effect.fnUntraced(function* (deps: Pick<Dependencies, "fs">, directory: string) {
  const entries = yield* deps.fs.readDirectoryEntries(folder(directory)).pipe(Effect.orElseSucceed(() => []))

  return entries.flatMap((entry) => (entry.type === "file" && entry.name.endsWith(".json") ? [entry.name] : []))
})

/** Writes the folder's conversations into it, replacing what was packed before. Returns how many. */
export const pack = Effect.fn("Carry.pack")(function* (deps: Dependencies, directory: string) {
  const sessions = yield* held(deps, directory).pipe(
    Effect.mapError(() => new CarryError({ reason: "대화 목록을 읽지 못했습니다" })),
  )
  const target = folder(directory)
  const written = new Set<string>()

  for (const session of sessions) {
    const data = yield* deps.transfer
      .export({ sessionID: session.id })
      .pipe(Effect.mapError(() => new CarryError({ reason: `「${session.title}」 대화를 읽지 못했습니다` })))
    const name = `${session.id}.json`

    yield* deps.fs
      .writeWithDirs(path.join(target, name), encode(data))
      .pipe(Effect.mapError(() => new CarryError({ reason: `${target}에 쓰지 못했습니다` })))
    written.add(name)
  }

  // A conversation deleted since the last packing no longer travels with the folder.
  for (const name of yield* files(deps, directory))
    if (!written.has(name)) yield* deps.fs.remove(path.join(target, name)).pipe(Effect.ignore)

  if (written.size > 0)
    yield* deps.fs
      .writeWithDirs(path.join(target, NOTE), note)
      .pipe(Effect.mapError(() => new CarryError({ reason: `${target}에 쓰지 못했습니다` })))

  return { packed: written.size, folder: target }
})

/** How many conversations are packed in the folder. */
export const count = Effect.fn("Carry.count")(function* (deps: Pick<Dependencies, "fs">, directory: string) {
  return (yield* files(deps, directory)).length
})

/**
 * Reads the conversations packed in the folder into this 자비수, as conversations of this folder. One already here is
 * left as it is, so opening the folder again brings nothing twice. Returns the conversations that came in and how many
 * were left.
 */
export const unpack = Effect.fn("Carry.unpack")(function* (deps: Dependencies, directory: string) {
  const read = yield* Effect.forEach(yield* files(deps, directory), (name) =>
    deps.fs.readFileStringSafe(path.join(folder(directory), name)).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.map((text) => (text === undefined ? undefined : decode(text))),
    ),
  )
  const packed = read
    .flatMap((item) => (item?._tag === "Some" ? [item.value] : []))
    // A conversation started by another is read after the one that started it.
    .toSorted((a, b) => Number(a.info.parentID !== undefined) - Number(b.info.parentID !== undefined))
  const location = { directory: AbsolutePath.make(directory) }
  const result = { brought: [] as string[], kept: 0, failed: read.length - packed.length }

  for (const data of packed) {
    const outcome = yield* deps.transfer.import({ data, location }).pipe(
      Effect.as("brought" as const),
      Effect.catchTag("SessionTransfer.ImportConflictError", () => Effect.succeed("kept" as const)),
      Effect.catchTag("Session.NotFoundError", () => Effect.succeed("failed" as const)),
    )

    if (outcome === "brought") result.brought.push(data.info.id)
    else result[outcome]++
  }

  return result
})
