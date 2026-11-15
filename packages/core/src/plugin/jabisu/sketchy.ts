export * as Sketchy from "./sketchy.js"

import { ToolFailure } from "@opencode/ai"
import { FSUtil } from "@opencode/util/fs-util"
import { Data, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import path from "path"
import { inflateRawSync } from "zlib"
import type { Tool } from "../../tool.js"

// Sketchy (ddkbs/sketchy, MIT — jabisu/LICENSE.sketchy) is an MCP server that draws what the model explains by hand
// and lets the reader step through it. 자비수 runs 명상's fork, which draws Hangul and saves into the 작업실. It is
// not in the installer: the first time it is wanted the user is asked, and one pinned archive is fetched from the
// fork's release, checked against the digest below, and unpacked under 자비수's data folder. Nothing else is trusted
// to say what the archive should be.

export const ID = "sketchy"
export const VERSION = "0.2.0-jabisu.1"
export const URL = `https://github.com/SeokMyungSeop/sketchy/releases/download/v${VERSION}/sketchy-${VERSION}.zip`
export const SHA256 = "68a2c68f4b9ef75e39b2210bb683b817789c4726db0df9f9dab80696cb5dbbed"
/** The archive's size, which the user is told before agreeing to the download. */
export const BYTES = 27_778_877

/** The permission the user answers before anything is downloaded. */
export const ACTION = "sketchy_install"

/** The folder inside a 작업실 that drawings are saved into, where the app's browser may open them. */
export const DRAWINGS = "그림"

const TIMEOUT = "120 seconds"

export class SketchyError extends Data.TaggedError("JabisuSketchyError")<{ readonly reason: string }> {}

/** Where this version is unpacked; another version gets a folder of its own. */
export const folder = (data: string) => path.join(data, "jabisu", "sketchy", VERSION)

const entry = (root: string) => path.join(root, "dist", "index.js")
// Written last, so a folder that has it was unpacked whole.
const marker = (root: string) => path.join(root, ".installed")

/** Whether this version was unpacked whole. */
export const installed = (fs: FSUtil.Interface, root: string) =>
  fs.readFileStringSafe(marker(root)).pipe(
    Effect.map((text) => text?.trim() === SHA256),
    Effect.orElseSucceed(() => false),
  )

/**
 * The MCP server for one 작업실. The engine runs it as its own JavaScript runtime, so no Node.js is needed. Photo
 * labeling stays off: it would download a model of hundreds of megabytes.
 */
export const server = (runtime: string, root: string, data: string, directory: string) => ({
  type: "local" as const,
  command: [runtime, entry(root)],
  environment: {
    BUN_BE_BUN: "1",
    SKETCHY_PHOTOS: "off",
    SKETCHY_DATA_DIR: path.join(data, "jabisu", "sketchy", "data"),
    SKETCHY_STANDALONE_DIR: path.join(directory, DRAWINGS),
  },
  codemode: false,
  disabled: true,
})

const hex = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("hex")

/** The files of a zip archive, read from its central directory. */
export function unzip(archive: Uint8Array): { readonly name: string; readonly content: Uint8Array }[] {
  const data = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength)
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))

  if (end < 0) throw new Error("not a zip archive")
  const count = data.readUInt16LE(end + 10)
  const files: { name: string; content: Uint8Array }[] = []
  let at = data.readUInt32LE(end + 16)

  for (let index = 0; index < count; index++) {
    if (data.readUInt32LE(at) !== 0x02014b50) throw new Error("zip directory is damaged")
    const method = data.readUInt16LE(at + 10)
    const packed = data.readUInt32LE(at + 20)
    const name = data.subarray(at + 46, at + 46 + data.readUInt16LE(at + 28)).toString("utf8")
    const local = data.readUInt32LE(at + 42)

    at += 46 + data.readUInt16LE(at + 28) + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32)
    if (name.endsWith("/")) continue
    // A name must stay inside the folder it is unpacked into.
    if (path.posix.isAbsolute(name) || name.includes("\\") || name.split("/").includes("..") || /^[a-z]:/i.test(name))
      throw new Error(`zip entry leaves its folder: ${name}`)
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    const body = data.subarray(start, start + packed)

    if (method !== 0 && method !== 8) throw new Error(`zip entry is packed in an unknown way: ${name}`)
    files.push({ name: name.replace(/^\.\//, ""), content: method === 8 ? inflateRawSync(body) : body })
  }

  return files
}

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly http: HttpClient.HttpClient
}

/** Fetches the pinned archive, checks it, and unpacks it into `root`. A failure leaves nothing that looks installed. */
export const install = Effect.fn("Sketchy.install")(function* (
  deps: Dependencies,
  root: string,
  source = { url: URL, sha256: SHA256 },
) {
  const archive = yield* HttpClientRequest.get(source.url).pipe(
    deps.http.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.arrayBuffer),
    Effect.timeoutOrElse({
      duration: TIMEOUT,
      orElse: () => Effect.fail(new SketchyError({ reason: "2분 안에 내려받지 못했습니다. 인터넷 연결을 확인해 주세요" })),
    }),
    Effect.mapError((error) =>
      error instanceof SketchyError
        ? error
        : new SketchyError({
            reason: "그림 도구를 내려받지 못했습니다. 인터넷에 연결돼 있는지, github.com이 막혀 있지 않은지 확인해 주세요",
          }),
    ),
  )
  const digest = hex(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", archive)))

  if (digest !== source.sha256)
    return yield* new SketchyError({
      reason: "내려받은 파일이 자비수가 아는 파일과 다릅니다. 안전을 위해 설치하지 않았습니다. 잠시 뒤 다시 해 보세요",
    })
  const files = yield* Effect.try({
    try: () => unzip(new Uint8Array(archive)),
    catch: () => new SketchyError({ reason: "내려받은 파일을 풀지 못했습니다" }),
  })

  yield* Effect.gen(function* () {
    // An earlier try that stopped half way is cleared first.
    yield* deps.fs.remove(root, { recursive: true, force: true })
    for (const file of files) yield* deps.fs.writeWithDirs(path.join(root, ...file.name.split("/")), file.content)
    yield* deps.fs.writeWithDirs(marker(root), source.sha256)
  }).pipe(
    Effect.mapError(() => new SketchyError({ reason: `${root} 폴더에 파일을 쓰지 못했습니다. 디스크 공간과 권한을 확인해 주세요` })),
  )
})

export const name = "sketchy_turn_on"

export const Input = Schema.Struct({})
export const Output = Schema.Struct({ installed: Schema.Boolean })

/** What the tool needs from the 작업실 it runs in. */
export interface Here {
  /** Whether the drawing tool is unpacked and ready to start. */
  readonly ready: Effect.Effect<boolean>
  /** Asks the user before the download; fails when they refuse. */
  readonly ask: (context: Context) => Effect.Effect<void, ToolFailure>
  readonly install: Effect.Effect<void, SketchyError>
  /** Registers the server, keeps it on in this 작업실, and reports whether it connected. */
  readonly start: Effect.Effect<string | undefined>
}

export type Context = Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">

const megabytes = Math.round(BYTES / 1_000_000)

/** The tool that gets the drawing server ready: downloads it once with the user's leave, then turns it on. */
export function tool(here: Here) {
  return {
    name,
    options: { codemode: false },
    description: `Get the Sketchy drawing tools ready in this 작업실. The first time, this downloads them (about ${megabytes} MB, once) after the user approves; later it only turns them on. Call it when the sketch tool is not available.`,
    input: Input,
    output: Output,
    execute: (_input: typeof Input.Type, context: Context) =>
      Effect.gen(function* () {
        const had = yield* here.ready

        if (!had) {
          yield* here.ask(context)
          yield* here.install.pipe(Effect.mapError((error) => new ToolFailure({ message: error.reason })))
        }
        const problem = yield* here.start

        if (problem)
          return yield* new ToolFailure({
            message: `The drawing tools did not start (${problem}). Tell the user, and explain in words instead.`,
          })

        return {
          output: { installed: !had },
          content: `${had ? "" : "The drawing tools were downloaded and installed. "}They are on in this 작업실 until 자비수 restarts. Draw with the sketch tool; each drawing is saved as an HTML file in the 작업실's 「${DRAWINGS}」 folder.`,
        }
      }),
  }
}
