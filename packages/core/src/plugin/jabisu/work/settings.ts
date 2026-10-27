export * as WorkSettings from "./settings.js"

import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import path from "path"
import { WorkProfile } from "./profile.js"

// The folders 자비수 indexes, by what they hold: its own work folder, which is always indexed; the folders where
// received files land, such as downloads and messenger folders; and the folders where the user files their work.
// The user chooses the last two; the app only suggests received-file folders it finds.

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Global.Interface
}

/** `jabisu`: 자비수's own work folder; `received`: where received files land; `saved`: where the user files work. */
export type Role = "jabisu" | "received" | "saved"

const Settings = Schema.Struct({ received: Schema.Array(Schema.String), saved: Schema.Array(Schema.String) })
export type Settings = typeof Settings.Type

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Settings))

export const file = (global: Pick<Global.Interface, "config">) => path.join(global.config, "jabisu-work.json")

/** The chosen folders; none when the file is missing or unreadable. */
export const read = Effect.fn("WorkSettings.read")(function* (deps: Dependencies) {
  const text = yield* deps.fs.readFileStringSafe(file(deps.global)).pipe(Effect.orElseSucceed(() => undefined))
  const parsed = text === undefined ? undefined : decode(text)

  return parsed?._tag === "Some" ? parsed.value : ({ received: [], saved: [] } satisfies Settings)
})

/** Saves the chosen folders as absolute paths, each once and in one role; 자비수's own folder is always indexed. */
export const write = Effect.fn("WorkSettings.write")(function* (deps: Dependencies, settings: Settings) {
  const taken = new Set([key(WorkProfile.folder(deps.global))])
  const unique = (folders: readonly string[]) =>
    folders.flatMap((folder) => {
      if (taken.has(key(folder))) return []
      taken.add(key(folder))

      return [path.resolve(folder)]
    })
  const saved = { received: unique(settings.received), saved: unique(settings.saved) } satisfies Settings

  yield* deps.fs.writeWithDirs(file(deps.global), JSON.stringify(saved, null, 2))

  return saved
})

/** Windows compares paths without case and with either separator. */
export const key = (folder: string) => path.resolve(folder).replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase()

/** Every folder to index with its role: 자비수's own folder once it exists, then the chosen ones. */
export const roots = Effect.fn("WorkSettings.roots")(function* (deps: Dependencies) {
  const settings = yield* read(deps)
  const jabisu = WorkProfile.folder(deps.global)
  const hasJabisu = yield* deps.fs.isDir(jabisu)
  const all: { folder: string; role: Role }[] = [
    ...(hasJabisu ? [{ folder: jabisu, role: "jabisu" as const }] : []),
    ...settings.received.map((folder) => ({ folder, role: "received" as const })),
    ...settings.saved.map((folder) => ({ folder, role: "saved" as const })),
  ]

  // A hand-edited settings file may name a folder twice; its first role counts.
  const seen = new Set<string>()

  return all.filter((root) => !seen.has(key(root.folder)) && Boolean(seen.add(key(root.folder))))
})

// Messengers save received files into a folder under Documents whose name says so, such as 세종 메신저 받은 파일 or
// 카카오톡 받은 파일; the user can move it, so any folder there with that name is offered.
const RECEIVED = /받은\s*파일/

/** Received-file folders on this PC the app offers to add: the downloads folder and messenger folders. */
export const candidates = Effect.fn("WorkSettings.candidates")(function* (deps: Dependencies) {
  const documents = path.join(deps.global.home, "Documents")
  const entries = yield* deps.fs.readDirectoryEntries(documents).pipe(Effect.orElseSucceed(() => []))
  const received = entries
    .filter((entry) => entry.type === "directory" && RECEIVED.test(entry.name))
    .map((entry) => ({ path: path.join(documents, entry.name), kind: "messenger" as const }))
  const downloads = path.join(deps.global.home, "Downloads")
  const hasDownloads = yield* deps.fs.isDir(downloads)

  return [...(hasDownloads ? [{ path: downloads, kind: "downloads" as const }] : []), ...received]
})
