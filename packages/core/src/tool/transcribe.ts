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

export const DEFAULT_MODEL = "openai/gpt-audio-mini"

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
// out in parts of at most 5 minutes, a few at a time. A part ends at the quietest tenth of a second in its last 20
// seconds, so a cut seldom falls inside a word.
const SAMPLE_RATE = 16_000
const PART_SAMPLES = 300 * SAMPLE_RATE
const SEARCH_SAMPLES = 20 * SAMPLE_RATE
const FRAME_SAMPLES = SAMPLE_RATE / 10
const CONCURRENCY = 3
const WAV_BYTES_PER_SECOND = SAMPLE_RATE * 2

// The file's name often names the meeting, the agency or the law, which the model would otherwise mishear. Models
// keep to the layout better with an example; its lines are placeholders, so one copied by mistake reads as one.
const prompt = (file: string, seconds: number) =>
  [
    "이 녹음을 들리는 그대로 받아쓰세요. 한국어는 한글로 적고 한자나 중국어로 옮기지 않습니다. 외국어는 원어로 적습니다.",
    `녹음 파일 이름은 「${path.parse(file).name}」입니다. 이름에 나오는 기관·사업·법령 이름이 들리면 그 표기대로 적습니다.`,
    `이 녹음은 ${Math.floor(Math.round(seconds) / 60)}분 ${Math.round(seconds) % 60}초 길이입니다. 회의록에 쓰도록 아래처럼 한 줄에 시간, 화자 번호, 말을 적습니다.`,
    "[00:00] 화자 1: (첫 사람이 한 말)",
    "[00:24] 화자 1: (같은 사람이 이어서 한 말)",
    "[00:51] 화자 2: (다른 사람이 한 말)",
    "- 말하는 사람이 바뀌면 반드시 새 줄을 시작하고, 목소리가 다르면 다른 화자 번호를 씁니다. 같은 사람은 끝까지 같은 번호를 씁니다.",
    "- 한 줄은 30초를 넘기지 않습니다. 한 사람이 길게 말하면 문장이 끝나는 곳에서 줄을 나누고 그 줄이 시작하는 시간을 적습니다.",
    "- 시간은 이 녹음의 시작부터 지난 분:초이고 녹음 길이를 넘지 않습니다.",
    "- 잘 들리지 않는 말은 지어내지 말고 (잘 안 들림)으로 적습니다. 요약이나 설명 없이 받아쓴 내용만 출력합니다.",
  ].join("\n")

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Global.Interface
  readonly http: HttpClient.HttpClient
  readonly integrations: Integration.Interface
  readonly process: AppProcess.Interface
}

/**
 * The recording's transcript, made once per file version and model and then served from the cache. When some parts
 * fail, the others come back with the gaps marked, and reading the recording again asks only for the missing parts.
 */
export const transcript = Effect.fn("Transcribe.transcript")(function* (deps: Dependencies, file: string) {
  const settings = yield* readSettings(deps)
  if (!settings.enabled)
    return yield* new TranscribeError({
      reason:
        "audio transcription is turned off. Tell the user they can turn it on in 설정 → 환경 설정 → 음성 받아쓰기, which needs an OpenRouter connection",
    })
  const key = yield* openRouterKey(deps)
  if (!key)
    return yield* new TranscribeError({
      reason: "audio transcription needs an OpenRouter connection. Tell the user to connect OpenRouter in Settings",
    })
  const cached = yield* cachePath(deps, file, settings.model)
  const hit = yield* deps.fs.readFileStringSafe(cached).pipe(Effect.orElseSucceed(() => undefined))
  if (hit) return hit

  // Each part's answer is kept beside the transcript until the whole is made, so a stopped or failed transcript
  // continues where it ended instead of paying again.
  const kept = cached.slice(0, -".md".length)
  const converted = path.join(deps.global.tmp, `transcribe-${Hash.fast(cached)}.wav`)
  const parts = yield* Effect.gen(function* () {
    yield* toWav(deps, file, converted)
    const pcm = yield* readPcm(converted)
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
    if (samples.length === 0) return yield* new TranscribeError({ reason: "the converted recording has no audio" })
    const ends = boundaries(samples)
    // Asked once, and only when a part still needs a request.
    const reasoning = yield* Effect.cached(OpenRouter.reasoning(deps.http, settings.model))
    return yield* Effect.forEach(
      ends.map((end, index) => ({ start: ends[index - 1] ?? 0, end })),
      (part) => {
        const answer = path.join(kept, `${part.start}-${part.end}.txt`)
        return Effect.gen(function* () {
          const saved = yield* deps.fs.readFileStringSafe(answer).pipe(Effect.orElseSucceed(() => undefined))
          if (saved !== undefined) return { ...part, text: saved, cost: 0, stopped: undefined }
          const audio = pcm.subarray(part.start * 2, part.end * 2)
          const ask = OpenRouter.complete(deps.http, {
            key,
            model: settings.model,
            content: [
              { type: "text", text: prompt(file, audio.length / WAV_BYTES_PER_SECOND) },
              { type: "input_audio", input_audio: { data: Buffer.from(wav(audio)).toString("base64"), format: "wav" } },
            ],
            // Models answer a 5-minute part in 15 seconds to about 2 minutes; one unanswered at 4 has hung.
            timeout: "4 minutes",
            reasoning: yield* reasoning,
          })
          // A model that stops partway, as at a provider's safety filter, often finishes when asked again.
          const first = yield* ask
          const completion = first.stopped ? yield* ask : first
          const cost = (first.cost ?? 0) + (completion === first ? 0 : (completion.cost ?? 0))
          // An answer cut short is shown but not kept, so reading the recording again asks for the part anew.
          if (!completion.stopped) yield* deps.fs.writeWithDirs(answer, completion.text).pipe(Effect.ignore)
          return { ...part, text: completion.text, cost, stopped: completion.stopped }
        }).pipe(Effect.catch((error) => Effect.succeed({ ...part, text: undefined, cost: 0, failure: error.message })))
      },
      { concurrency: CONCURRENCY },
    )
  }).pipe(Effect.ensuring(deps.fs.remove(converted, { force: true }).pipe(Effect.ignore)))

  const failed = parts.filter((part) => part.text === undefined)
  if (failed.length === parts.length)
    return yield* new TranscribeError({ reason: `OpenRouter could not transcribe it (${failed[0]?.failure})` })
  const unfinished = parts.filter((part) => part.text === undefined || part.stopped)
  const sections = parts.map((part) => ({
    heading: `## ${clock(part.start / SAMPLE_RATE)}–${clock(part.end / SAMPLE_RATE)}`,
    lines:
      part.text === undefined
        ? ""
        : normalize(part.text, part.start / SAMPLE_RATE, (part.end - part.start) / SAMPLE_RATE) || "(들린 말 없음)",
    note:
      part.text === undefined
        ? `(확인 필요: 이 구간은 받아쓰지 못했습니다. ${part.failure})`
        : part.stopped
          ? `(확인 필요: 모델이 이 구간을 끝까지 받아쓰지 않고 멈췄습니다(${part.stopped}). 뒷부분이 빠졌을 수 있습니다.)`
          : "",
  }))
  const doubtful = sections.reduce((total, section) => total + (section.lines.match(/\(확인 필요: /g)?.length ?? 0), 0)
  const cost = parts.reduce((total, part) => total + part.cost, 0)
  const text = [
    `# Transcript of ${path.basename(file)}`,
    `- Length ${clock((parts.at(-1)?.end ?? 0) / SAMPLE_RATE)} in ${parts.length} part(s) of up to 5 minutes, model ${settings.model}, OpenRouter cost $${cost.toFixed(4)} this time`,
    "- Times are from the start of the recording. Each ## part numbers its own speakers, so 화자 1 in one part may be another person in the next.",
    ...(doubtful
      ? [
          `- ${doubtful} line(s) end in (확인 필요): Chinese characters, or a time past the part's end, where the model may have misheard or made words up.`,
        ]
      : []),
    ...(unfinished.length
      ? [
          `- ${unfinished.length} of ${parts.length} part(s) are missing or stopped partway. Reading the recording again asks only for those parts.`,
        ]
      : []),
    ...sections.flatMap((section) => ["", section.heading, ...[section.lines, section.note].filter(Boolean)]),
  ].join("\n")
  if (unfinished.length) return text
  yield* deps.fs.writeWithDirs(cached, text).pipe(Effect.ignore)
  yield* deps.fs.remove(kept, { recursive: true, force: true }).pipe(Effect.ignore)
  return text
})

/** Where each part ends, in samples: at most 5 minutes after the last end, at the quietest moment near that limit. */
export function boundaries(samples: Int16Array, start = 0): number[] {
  if (samples.length - start <= PART_SAMPLES) return [samples.length]
  const energy = (from: number) =>
    samples.subarray(from, from + FRAME_SAMPLES).reduce((total, sample) => total + sample * sample, 0)
  const quietest = Array.from(
    { length: SEARCH_SAMPLES / FRAME_SAMPLES },
    (_, index) => start + PART_SAMPLES - SEARCH_SAMPLES + index * FRAME_SAMPLES,
  )
    .map((frame) => ({ frame, energy: energy(frame) }))
    .reduce((best, next) => (next.energy <= best.energy ? next : best))
  const end = quietest.frame + FRAME_SAMPLES / 2
  return [end, ...boundaries(samples, end)]
}

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
// Korean speech is written in Hangul, so Chinese characters are the model slipping into Chinese.
const HAN = /\p{Script=Han}/u
// Models round the last line's time up, so a time is past the part only beyond this.
const SLACK_SECONDS = 2

/**
 * The model's lines as `[hh:mm:ss] 화자 N: text`, shifted by the part's start. Models answer in their own layouts
 * (`0.13-1.72 | SPEAKER_00: …`, `[00:05] 화자 1: …`, `00:00-00:08 [00:00] …`), and number speakers from 0 or 1.
 * A line with Chinese characters or a time past the part's `length` in seconds ends in `(확인 필요: …)`.
 */
export function normalize(text: string, offset: number, length = Infinity) {
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
    .map((line) => {
      const doubts = [
        HAN.test(line.words) ? "한자·중국어가 섞임" : undefined,
        line.seconds > length + SLACK_SECONDS ? "구간 길이를 넘는 시간" : undefined,
      ].filter((doubt) => doubt !== undefined)
      return `[${clock(offset + line.seconds)}]${line.speaker === undefined ? "" : ` 화자 ${line.speaker + shift}:`} ${line.words}${doubts.length ? ` (확인 필요: ${doubts.join(", ")})` : ""}`
    })
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
