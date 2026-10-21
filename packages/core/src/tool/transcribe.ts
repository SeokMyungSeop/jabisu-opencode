export * as Transcribe from "./transcribe.js"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { HttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { AppProcess } from "@opencode/util/process"
import type { Integration } from "../integration.js"
import { OpenRouter } from "./openrouter.js"

// 자비수: turns a recording into a timestamped transcript for meeting minutes through an OpenRouter audio model.
// The user turns it on in the app's settings, which write `jabisu.json` beside the OpenCode config.

export const DEFAULT_MODEL = "xiaomi/mimo-v2.6-flash"

/** The settings the app writes to `<config>/jabisu.json`. */
export const Settings = Schema.Struct({
  transcription: Schema.optional(
    Schema.Struct({ enabled: Schema.optional(Schema.Boolean), model: Schema.optional(Schema.String) }),
  ),
})

/** An expected reason a recording has no transcript, reported to the model as its own message. */
export class TranscribeError extends Schema.TaggedError<TranscribeError>()("Transcribe.TranscribeError", {
  reason: Schema.String,
}) {}

// Audio models take at most 10 minutes a request, and some providers refuse a 19 MB body, so 16 kHz mono WAV goes
// out in 5-minute pieces, a few at a time.
const SECONDS_PER_CHUNK = 300
const CONCURRENCY = 3
const WAV_BYTES_PER_SECOND = 16_000 * 2

const PROMPT = [
  "이 녹음을 들리는 그대로 받아쓰세요. 한국어는 한국어로, 외국어는 원어로 적습니다.",
  "말하는 사람이 바뀔 때마다 새 줄에 `[01:23] 화자 1: 안녕하세요.`처럼 시간, 화자 번호, 내용을 한 줄로 적습니다. 시간은 이 녹음의 시작부터 지난 분:초입니다.",
  "같은 사람은 끝까지 같은 번호를 씁니다. 요약이나 설명 없이 받아쓴 내용만 출력합니다.",
].join("\n")

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Global.Interface
  readonly http: HttpClient.HttpClient
  readonly integrations: Integration.Interface
  readonly process: AppProcess.Interface
}

/** The recording's transcript, made once per file version and model and then served from the cache. */
export const transcript = Effect.fn("Transcribe.transcript")(function* (deps: Dependencies, file: string) {
  const settings = yield* readSettings(deps)
  if (!settings.enabled)
    return yield* new TranscribeError({
      reason:
        "audio transcription is turned off. Tell the user they can turn it on in Settings → Audio transcription, which needs an OpenRouter connection",
    })
  const key = yield* openRouterKey(deps)
  if (!key)
    return yield* new TranscribeError({
      reason: "audio transcription needs an OpenRouter connection. Tell the user to connect OpenRouter in Settings",
    })
  const cached = yield* cachePath(deps, file, settings.model)
  const hit = yield* deps.fs.readFileStringSafe(cached).pipe(Effect.orElseSucceed(() => undefined))
  if (hit) return hit

  const wav = path.join(deps.global.tmp, `transcribe-${Hash.fast(cached)}.wav`)
  const text = yield* Effect.gen(function* () {
    yield* toWav(deps, file, wav)
    const pcm = yield* readPcm(wav)
    const seconds = pcm.length / WAV_BYTES_PER_SECOND
    const chunks = Array.from(
      { length: Math.ceil(pcm.length / (SECONDS_PER_CHUNK * WAV_BYTES_PER_SECOND)) },
      (_, i) => ({
        start: i * SECONDS_PER_CHUNK,
        pcm: pcm.subarray(
          i * SECONDS_PER_CHUNK * WAV_BYTES_PER_SECOND,
          (i + 1) * SECONDS_PER_CHUNK * WAV_BYTES_PER_SECOND,
        ),
      }),
    )
    const parts = yield* Effect.forEach(chunks, (chunk) => request(deps, key, settings.model, chunk), {
      concurrency: CONCURRENCY,
    })
    const cost = parts.reduce((total, part) => total + (part.cost ?? 0), 0)
    return [
      `# Transcript of ${path.basename(file)}`,
      `- Length ${clock(seconds)}, ${chunks.length} part(s) of up to ${SECONDS_PER_CHUNK / 60} minutes, model ${settings.model}, OpenRouter cost $${cost.toFixed(4)}`,
      "- Speaker numbers are the model's guess and may restart in each part; times are from the start of the recording.",
      "",
      ...parts.map((part) => part.text),
    ].join("\n")
  }).pipe(Effect.ensuring(deps.fs.remove(wav, { force: true }).pipe(Effect.ignore)))

  yield* deps.fs.writeWithDirs(cached, text).pipe(Effect.ignore)
  return text
})

/** The transcript already made for this version of the recording with the chosen model; never makes one. */
export const existing = Effect.fn("Transcribe.existing")(function* (
  deps: Pick<Dependencies, "fs" | "global">,
  file: string,
) {
  const settings = yield* readSettings(deps)
  const cached = yield* cachePath(deps, file, settings.model).pipe(Effect.orElseSucceed(() => undefined))
  if (!cached) return undefined
  return yield* deps.fs.readFileStringSafe(cached).pipe(Effect.orElseSucceed(() => undefined))
})

// One transcript per file version and model. The path is resolved so `/` and `\` spellings share it.
const cachePath = Effect.fn("Transcribe.cachePath")(function* (
  deps: Pick<Dependencies, "fs" | "global">,
  file: string,
  model: string,
) {
  const info = yield* deps.fs
    .stat(file)
    .pipe(Effect.mapError(() => new TranscribeError({ reason: "it cannot be read" })))
  const mtime = Option.getOrUndefined(info.mtime)?.getTime() ?? 0
  const key = `${path.resolve(file)}\0${info.size}\0${mtime}\0${model}`
  return path.join(deps.global.cache, "transcripts", `${Hash.fast(key)}.md`)
})

type SettingsDependencies = Pick<Dependencies, "fs" | "global" | "integrations">

/** What the app's settings show: the saved choice, the model in use, and whether an OpenRouter key is available. */
export const status = Effect.fn("Transcribe.status")(function* (deps: SettingsDependencies) {
  const settings = yield* readSettings(deps)
  return { ...settings, defaultModel: DEFAULT_MODEL, openrouter: (yield* openRouterKey(deps)) !== undefined }
})

/** Saves the app's choice to `jabisu.json`, keeping its other settings. Turning it on needs an OpenRouter key. */
export const update = Effect.fn("Transcribe.update")(function* (
  deps: SettingsDependencies,
  input: { readonly enabled: boolean; readonly model?: string },
) {
  if (input.enabled && (yield* openRouterKey(deps)) === undefined)
    return yield* new TranscribeError({ reason: "audio transcription needs an OpenRouter connection" })
  const file = settingsFile(deps)
  const raw = yield* deps.fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
  const current = Option.getOrElse(
    Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(raw ?? "{}"),
    () => ({}),
  )
  // The default model is left unsaved, so a later default reaches users who never chose one.
  const model = input.model?.trim()
  const transcription = {
    enabled: input.enabled,
    ...(model && model !== DEFAULT_MODEL ? { model } : {}),
  }
  yield* deps.fs
    .writeWithDirs(file, `${JSON.stringify({ ...current, transcription }, null, 2)}\n`)
    .pipe(Effect.mapError(() => new TranscribeError({ reason: `${file} cannot be written` })))
  return yield* status(deps)
})

const settingsFile = (deps: Pick<Dependencies, "global">) => path.join(deps.global.config, "jabisu.json")

const readSettings = Effect.fn("Transcribe.settings")(function* (deps: Pick<Dependencies, "fs" | "global">) {
  const raw = yield* deps.fs.readFileStringSafe(settingsFile(deps)).pipe(Effect.orElseSucceed(() => undefined))
  const parsed = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(Settings))(raw ?? "{}"),
  )?.transcription
  return { enabled: parsed?.enabled === true, model: parsed?.model?.trim() || DEFAULT_MODEL }
})

const openRouterKey = (deps: Pick<Dependencies, "integrations">) => OpenRouter.key(deps.integrations)

// Windows Media Foundation converts MP3, M4A, AAC, WMA, FLAC, WAV and the audio of MP4 or MOV videos with no extra
// software. The script runs in MTA, where WinRT completions reach AsTask, and exits itself, since WinRT keeps
// PowerShell alive after the conversion.
const CONVERT = `
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 }
$operation = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
$progress = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress\`1' } | Select-Object -First 1
function Await($async, $type) { $task = $operation.MakeGenericMethod($type).Invoke($null, @($async)); $task.Wait(-1) | Out-Null; $task.Result }
try {
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
  [void][Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]
  $target = $env:JABISU_AUDIO_TARGET
  $source = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:JABISU_AUDIO_SOURCE)) ([Windows.Storage.StorageFile])
  $folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync([IO.Path]::GetDirectoryName($target))) ([Windows.Storage.StorageFolder])
  $output = Await ($folder.CreateFileAsync([IO.Path]::GetFileName($target), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateWav([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
  $profile.Audio.SampleRate = 16000
  $profile.Audio.ChannelCount = 1
  $profile.Audio.BitsPerSample = 16
  $prepared = Await ((New-Object Windows.Media.Transcoding.MediaTranscoder).PrepareFileTranscodeAsync($source, $output, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
  if (-not $prepared.CanTranscode) { [Console]::Error.WriteLine("Windows cannot convert this audio: $($prepared.FailureReason)"); [Environment]::Exit(2) }
  $progress.MakeGenericMethod([double]).Invoke($null, @($prepared.TranscodeAsync())).Wait(-1) | Out-Null
  [Environment]::Exit(0)
} catch { [Console]::Error.WriteLine($_.Exception.Message); [Environment]::Exit(1) }
`

const toWav = Effect.fn("Transcribe.toWav")(function* (deps: Dependencies, file: string, target: string) {
  if (process.platform !== "win32") {
    if (path.extname(file).toLowerCase() === ".wav") return yield* deps.fs.copyFile(file, target).pipe(Effect.orDie)
    return yield* new TranscribeError({ reason: "only WAV recordings can be transcribed on this system" })
  }
  yield* deps.fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.ignore)
  const result = yield* deps.process
    .run(
      ChildProcess.make(
        "powershell.exe",
        [
          "-MTA",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          Buffer.from(CONVERT, "utf16le").toString("base64"),
        ],
        // Paths travel in the environment, so no quoting reaches the script. WinRT storage rejects `/` separators.
        {
          env: { JABISU_AUDIO_SOURCE: path.resolve(file), JABISU_AUDIO_TARGET: path.resolve(target) },
          extendEnv: true,
          stdin: "ignore",
        },
      ),
    )
    .pipe(
      Effect.mapError(() => new TranscribeError({ reason: "Windows PowerShell could not be started to convert it" })),
    )
  if (result.exitCode !== 0)
    return yield* new TranscribeError({
      reason: `Windows could not convert it to WAV (${result.stderr.toString("utf8").trim() || `exit ${result.exitCode}`}); MP3, M4A, WAV, AAC, WMA, FLAC and MP4 work`,
    })
})

// The PCM samples of the converted WAV, which is 16 kHz, 16-bit mono.
const readPcm = Effect.fn("Transcribe.readPcm")(function* (file: string) {
  const bytes = new Uint8Array(
    yield* Effect.tryPromise({
      try: () => Bun.file(file).arrayBuffer(),
      catch: () => new TranscribeError({ reason: "the converted recording could not be read" }),
    }),
  )
  const view = new DataView(bytes.buffer)
  for (let position = 12; position + 8 <= bytes.length; ) {
    const size = view.getUint32(position + 4, true)
    if (String.fromCharCode(...bytes.subarray(position, position + 4)) === "data")
      return bytes.subarray(position + 8, Math.min(position + 8 + size, bytes.length))
    position += 8 + size + (size % 2)
  }
  return yield* new TranscribeError({ reason: "the converted recording has no audio" })
})

const request = Effect.fn("Transcribe.request")(function* (
  deps: Dependencies,
  key: string,
  model: string,
  chunk: { readonly start: number; readonly pcm: Uint8Array },
) {
  const completion = yield* OpenRouter.complete(deps.http, {
    key,
    model,
    content: [
      { type: "text", text: PROMPT },
      { type: "input_audio", input_audio: { data: Buffer.from(wav(chunk.pcm)).toString("base64"), format: "wav" } },
    ],
    timeout: "8 minutes",
  }).pipe(
    Effect.retry({ times: 1 }),
    Effect.mapError(
      (error) =>
        new TranscribeError({
          reason: `OpenRouter could not transcribe the part from ${clock(chunk.start)} (${error.message})`,
        }),
    ),
  )
  return { text: normalize(completion.text, chunk.start), cost: completion.cost }
})

/** A 16 kHz, 16-bit mono WAV file around the samples. */
function wav(pcm: Uint8Array) {
  const header = new DataView(new ArrayBuffer(44))
  const ascii = (offset: number, text: string) =>
    Array.from(text).forEach((char, index) => header.setUint8(offset + index, char.charCodeAt(0)))
  ascii(0, "RIFF")
  header.setUint32(4, 36 + pcm.length, true)
  ascii(8, "WAVEfmt ")
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, 16_000, true)
  header.setUint32(28, WAV_BYTES_PER_SECOND, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  ascii(36, "data")
  header.setUint32(40, pcm.length, true)
  const out = new Uint8Array(44 + pcm.length)
  out.set(new Uint8Array(header.buffer))
  out.set(pcm, 44)
  return out
}

const CLOCK = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?`
const TIME = String.raw`(${CLOCK}|(?:hh:)?mm:ss)(?:\s*[-~]\s*${CLOCK})?`
// A leading time, bracketed or bare, alone or as a range. Models sometimes copy the placeholder `[mm:ss]` as is.
const STAMP = new RegExp(String.raw`^(?:\[${TIME}\]|${TIME}(?=[\s|]|$))(?:\s*[-~]\s*\[${CLOCK}\])?\s*\|?\s*`, "i")
// Diarizing models write seconds as a range: `0.13-1.72 | SPEAKER_00: …`.
const SECONDS = /^(\d+(?:\.\d+)?)\s*-\s*\d+(?:\.\d+)?\s*\|\s*/
const SPEAKER = /^(?:speaker[\s_]*(\d+)|화자\s*(\d+))\s*[:：]\s*/i

/**
 * The model's lines as `[hh:mm:ss] 화자 N: text`, shifted by the part's start. Models answer in their own layouts
 * (`0.13-1.72 | SPEAKER_00: …`, `[00:05] 화자 1: …`, `00:00-00:08 [00:00] …`), and number speakers from 0 or 1.
 */
export function normalize(text: string, offset: number) {
  const parsed = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```"))
    .map(parseLine)
  // A time on a line of its own belongs to the words on the next line; a line without a time continues the last.
  const lines = parsed.reduce(
    (state, line) => {
      const seconds = line.seconds ?? state.last
      if (line.words) state.lines.push({ seconds, speaker: line.speaker, words: line.words })
      return { lines: state.lines, last: seconds }
    },
    { lines: [] as Array<{ seconds: number; speaker?: number; words: string }>, last: 0 },
  ).lines
  const shift = lines.some((line) => line.speaker === 0) ? 1 : 0
  return lines
    .map(
      (line) =>
        `[${clock(offset + line.seconds)}]${line.speaker === undefined ? "" : ` 화자 ${line.speaker + shift}:`} ${line.words}`,
    )
    .join("\n")
}

/** One line's first real time, its speaker and its words, after every leading time and placeholder. */
function parseLine(text: string): { seconds?: number; speaker?: number; words: string } {
  const range = SECONDS.exec(text)
  if (range) return { ...parseLine(text.slice(range[0].length)), seconds: Number(range[1]) }
  const stamp = STAMP.exec(text)
  if (stamp) {
    const rest = parseLine(text.slice(stamp[0].length))
    const time = stamp[1] ?? stamp[2]
    return { ...rest, seconds: /\d/.test(time) ? fromClock(time) : rest.seconds }
  }
  const speaker = SPEAKER.exec(text)
  if (!speaker) return { words: text }
  return { speaker: Number(speaker[1] ?? speaker[2]), words: text.slice(speaker[0].length) }
}

function fromClock(text: string) {
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0)
}

function clock(seconds: number) {
  const whole = Math.floor(seconds)
  return [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}
