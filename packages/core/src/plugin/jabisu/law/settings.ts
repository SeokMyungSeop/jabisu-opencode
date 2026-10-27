export * as LawSettings from "./settings.js"

import type { FSUtil } from "@opencode/util/fs-util"
import type { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import path from "path"

// The user's key for the 국가법령정보 공동활용 Open API of 법제처. The user gets it free at open.law.go.kr and enters it
// in the settings; the law tools read it on every call, so a new key applies at once.

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Pick<Global.Interface, "config">
}

/** Where the user applies for a key. */
export const APPLY = "https://open.law.go.kr/LSO/openApi/guideList.do"

const Settings = Schema.Struct({ key: Schema.String })

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Settings))

export const file = (global: Pick<Global.Interface, "config">) => path.join(global.config, "jabisu-law.json")

/** The saved key; none when the file is missing, unreadable or empty. */
export const key = Effect.fn("LawSettings.key")(function* (deps: Dependencies) {
  const text = yield* deps.fs.readFileStringSafe(file(deps.global)).pipe(Effect.orElseSucceed(() => undefined))
  const parsed = text === undefined ? undefined : decode(text)
  const value = parsed?._tag === "Some" ? parsed.value.key.trim() : ""

  return value || undefined
})

/** Saves the key, or forgets it when it is empty. */
export const write = Effect.fn("LawSettings.write")(function* (deps: Dependencies, value: string) {
  const trimmed = value.trim()

  if (!trimmed) return yield* deps.fs.remove(file(deps.global)).pipe(Effect.ignore)
  yield* deps.fs.writeWithDirs(file(deps.global), JSON.stringify({ key: trimmed }, null, 2))
})
