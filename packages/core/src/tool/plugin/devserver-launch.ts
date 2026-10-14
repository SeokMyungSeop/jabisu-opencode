export * as DevServerLaunch from "./devserver-launch.js"

import path from "path"
import { Effect, Schema } from "effect"
import { type ParseError, parse } from "jsonc-parser"
import type { FSUtil } from "@opencode/util/fs-util"
import { ShellSelect } from "../../shell/select.js"

export const DEFAULT_PORT = 3000

// Claude Code's `.claude/launch.json` layout, so an existing file can be copied over or read in place.
export const FILES = [path.join(".opencode", "launch.json"), path.join(".claude", "launch.json")]

export const Configuration = Schema.Struct({
  name: Schema.String,
  runtimeExecutable: Schema.optionalKey(Schema.String),
  runtimeArgs: Schema.optionalKey(Schema.Array(Schema.String)),
  program: Schema.optionalKey(Schema.String),
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  port: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  autoPort: Schema.optionalKey(Schema.Boolean),
  cwd: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  url: Schema.optionalKey(Schema.String),
})
export type Configuration = typeof Configuration.Type

export const File = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  autoVerify: Schema.optionalKey(Schema.Boolean),
  configurations: Schema.Array(Configuration),
})

/** Reads the first launch file under the directory, preferring `.opencode/launch.json` over `.claude/launch.json`. */
export const load = Effect.fn("DevServerLaunch.load")(function* (fs: FSUtil.Interface, directory: string) {
  const candidates = FILES.map((file) => path.join(directory, file))
  const texts = yield* Effect.forEach(candidates, (file) => fs.readFileStringSafe(file))
  const index = texts.findIndex((text) => text !== undefined)
  const text = texts[index]
  if (text === undefined) return undefined
  const file = candidates[index]
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) return yield* Effect.fail(new Error(`${file} is not valid JSON or JSONC`))
  const launch = yield* Schema.decodeUnknownEffect(File)(input).pipe(
    Effect.mapError((error) => new Error(`${file} does not match the launch.json format: ${error.message}`)),
  )
  return { file, ...launch }
})

/**
 * Builds the command string that runs a configuration. It is the exact string the shell permission check sees, so
 * arguments are quoted only when needed and `npm run dev` still matches a saved `npm run *` approval.
 */
export function commandLine(configuration: Configuration, shell: string) {
  const parts = [
    configuration.runtimeExecutable ?? "node",
    ...(configuration.runtimeArgs ?? []),
    ...(configuration.program === undefined ? [] : [configuration.program]),
    ...(configuration.args ?? []),
  ]
  const quoted = parts.map((part) => quote(part, shell))
  // PowerShell evaluates a leading quoted string as an expression unless it is invoked with `&`.
  if (ShellSelect.ps(shell) && quoted[0] !== parts[0]) return `& ${quoted.join(" ")}`
  return quoted.join(" ")
}

function quote(value: string, shell: string) {
  if (ShellSelect.ps(shell)) return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`
  if (ShellSelect.name(shell) === "cmd")
    return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replaceAll('"', '""')}"`
  // POSIX shells, including Git Bash on Windows, treat a bare backslash as an escape, so Windows paths are quoted.
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
}
