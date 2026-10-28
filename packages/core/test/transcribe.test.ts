import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import type { ChildProcess } from "effect/process"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import type { Integration } from "@opencode/core/integration"
import { Transcribe } from "@opencode/core/tool/transcribe"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import type { AppProcess } from "@opencode/util/process"
import { testEffect } from "./lib/effect"
import { tmpdirScoped } from "./fixture/tmpdir"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node])))

const RATE = 16_000

/** 16 kHz mono samples that sound everywhere except in the given silent spans, in seconds. */
function recording(seconds: number, silences: ReadonlyArray<readonly [number, number]> = []) {
  const samples = new Int16Array(seconds * RATE).map((_, index) => (index % 2 ? 1000 : -1000))
  silences.forEach(([from, to]) => samples.fill(0, Math.round(from * RATE), Math.round(to * RATE)))
  return samples
}

function wavFile(samples: Int16Array) {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + samples.byteLength, 4)
  header.write("WAVEfmt ", 8, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(samples.byteLength, 40)
  return Buffer.concat([header, Buffer.from(samples.buffer)])
}

const unused = () => Effect.die("unused")

const integrations: Integration.Interface = {
  transform: unused,
  reload: unused,
  revision: () => 0,
  list: unused,
  get: unused,
  connection: {
    active: () =>
      Effect.succeed({ type: "credential", id: Credential.ID.make("openrouter"), label: "openrouter", method: "key" }),
    resolve: () => Effect.succeed(Credential.Key.make({ type: "key", key: "test-key" })),
    key: unused,
    external: unused,
    activate: unused,
    update: unused,
    remove: unused,
    status: unused,
  },
  oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
  command: { connect: unused, status: unused, cancel: unused },
}

// Windows converts the recording with PowerShell; the test's recording is already the WAV it would make.
const convert = (fs: FSUtil.Interface) =>
  ({
    run: (command: ChildProcess.Command) =>
      Effect.gen(function* () {
        const env = command._tag === "StandardCommand" ? (command.options.env ?? {}) : {}
        yield* fs.copyFile(env.JABISU_AUDIO_SOURCE ?? "", env.JABISU_AUDIO_TARGET ?? "").pipe(Effect.orDie)
        return {
          command: "powershell.exe",
          exitCode: 0,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          stdoutTruncated: false,
          stderrTruncated: false,
        }
      }),
  }) as unknown as AppProcess.Interface

// OpenRouter answering every part with the same lines, refusing the last, 1-minute part as too large, or cutting the
// first answers short at a safety filter. Its catalogue lists Gemini as a model that cannot answer without reasoning.
function openRouter(options: { readonly refuseLast?: boolean; readonly cutShort?: number }) {
  const prompts: string[] = []
  const reasoning: unknown[] = []
  const http = HttpClient.make((request) => {
    const json = (value: unknown, status = 200) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(value), { status })))
    if (request.method === "GET")
      return json({
        data: [
          { id: "xiaomi/mimo-v2.6-flash", reasoning: { mandatory: false } },
          {
            id: "google/gemini-3.8-flash",
            reasoning: { mandatory: true, supported_efforts: ["high", "medium", "low"] },
          },
        ],
      })
    const body = JSON.parse(request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "{}")
    const prompt: string = body.messages[0].content[0].text

    prompts.push(prompt)
    reasoning.push(body.reasoning)
    if (options.refuseLast && prompt.includes("1분 0초"))
      return json({ error: { code: 413, message: "Request Entity Too Large" } }, 413)
    if (prompts.length <= (options.cutShort ?? 0))
      return json({
        choices: [{ message: { content: "[00:01] 화자 1: 규제 특" }, finish_reason: "content_filter" }],
        usage: { cost: 0 },
      })
    return json({
      choices: [
        { message: { content: "[00:01] 화자 1: 안녕하세요.\n[00:03] 화자 2: 特区 계획입니다.\n[09:30] 화자 1: 끝." } },
      ],
      usage: { cost: 0.001 },
    })
  })
  return { http, prompts, reasoning }
}

describe("Transcribe.transcript", () => {
  it.live("marks a part OpenRouter refused, then asks only for that part when read again", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = (yield* tmpdirScoped()).path
      const global = Global.make({
        config: path.join(root, "config"),
        cache: path.join(root, "cache"),
        tmp: path.join(root, "tmp"),
      })
      const file = path.join(root, "초광역특구 설명회.wav")
      const deps = (http: HttpClient.HttpClient) => ({ fs, global, http, integrations, process: convert(fs) })
      yield* fs.writeWithDirs(
        path.join(global.config, "jabisu.json"),
        JSON.stringify({ transcription: { enabled: true } }),
      )
      yield* fs.writeWithDirs(file, wavFile(recording(660)))

      const refused = openRouter({ refuseLast: true })
      const partial = yield* Transcribe.transcript(deps(refused.http), file)
      expect(refused.prompts).toHaveLength(3)
      expect(refused.prompts[0]).toContain("「초광역특구 설명회」")
      expect(refused.reasoning).toEqual([{ enabled: false }, { enabled: false }, { enabled: false }])
      expect(partial).toContain("- 1 of 3 part(s) are missing or stopped partway.")
      expect(partial).toContain(
        '## 00:09:59–00:11:00\n(확인 필요: 이 구간은 받아쓰지 못했습니다. OpenRouter answered HTTP 413 "Request Entity Too Large"; the request is too large for the model\'s provider)',
      )
      expect(yield* Transcribe.existing({ fs, global }, file)).toBeUndefined()

      const answered = openRouter({})
      const whole = yield* Transcribe.transcript(deps(answered.http), file)
      expect(answered.prompts).toHaveLength(1)
      expect(whole.split("\n")).toEqual([
        "# Transcript of 초광역특구 설명회.wav",
        "- Length 00:11:00 in 3 part(s) of up to 5 minutes, model openai/gpt-audio-mini, OpenRouter cost $0.0010 this time",
        "- Times are from the start of the recording. Each ## part numbers its own speakers, so 화자 1 in one part may be another person in the next.",
        "- 6 line(s) end in (확인 필요): Chinese characters, or a time past the part's end, where the model may have misheard or made words up.",
        "",
        "## 00:00:00–00:04:59",
        "[00:00:01] 화자 1: 안녕하세요.",
        "[00:00:03] 화자 2: 特区 계획입니다. (확인 필요: 한자·중국어가 섞임)",
        "[00:09:30] 화자 1: 끝. (확인 필요: 구간 길이를 넘는 시간)",
        "",
        "## 00:04:59–00:09:59",
        "[00:05:00] 화자 1: 안녕하세요.",
        "[00:05:02] 화자 2: 特区 계획입니다. (확인 필요: 한자·중국어가 섞임)",
        "[00:14:29] 화자 1: 끝. (확인 필요: 구간 길이를 넘는 시간)",
        "",
        "## 00:09:59–00:11:00",
        "[00:10:00] 화자 1: 안녕하세요.",
        "[00:10:02] 화자 2: 特区 계획입니다. (확인 필요: 한자·중국어가 섞임)",
        "[00:19:29] 화자 1: 끝. (확인 필요: 구간 길이를 넘는 시간)",
      ])
      expect(yield* Transcribe.existing({ fs, global }, file)).toBe(whole)
      expect(yield* fs.readDirectoryEntries(path.join(global.cache, "transcripts"))).toHaveLength(1)
    }),
  )

  it.live("asks a model that cannot turn reasoning off for its least effort", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = (yield* tmpdirScoped()).path
      const global = Global.make({
        config: path.join(root, "config"),
        cache: path.join(root, "cache"),
        tmp: path.join(root, "tmp"),
      })
      const file = path.join(root, "회의.wav")
      const server = openRouter({})
      yield* fs.writeWithDirs(
        path.join(global.config, "jabisu.json"),
        JSON.stringify({ transcription: { enabled: true, model: "google/gemini-3.8-flash" } }),
      )
      yield* fs.writeWithDirs(file, wavFile(recording(60)))

      yield* Transcribe.transcript({ fs, global, http: server.http, integrations, process: convert(fs) }, file)
      expect(server.reasoning).toEqual([{ effort: "low" }])
    }),
  )

  it.live("asks again when a model stops partway, and marks and does not keep an answer cut short twice", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = (yield* tmpdirScoped()).path
      const global = Global.make({
        config: path.join(root, "config"),
        cache: path.join(root, "cache"),
        tmp: path.join(root, "tmp"),
      })
      const once = path.join(root, "한 번.wav")
      const twice = path.join(root, "두 번.wav")
      const deps = (http: HttpClient.HttpClient) => ({ fs, global, http, integrations, process: convert(fs) })
      yield* fs.writeWithDirs(
        path.join(global.config, "jabisu.json"),
        JSON.stringify({ transcription: { enabled: true } }),
      )
      yield* fs.writeWithDirs(once, wavFile(recording(60)))
      yield* fs.writeWithDirs(twice, wavFile(recording(60)))

      const recovered = openRouter({ cutShort: 1 })
      const whole = yield* Transcribe.transcript(deps(recovered.http), once)
      expect(recovered.prompts).toHaveLength(2)
      expect(whole).not.toContain("멈췄습니다")
      expect(yield* Transcribe.existing({ fs, global }, once)).toBe(whole)

      const filtered = openRouter({ cutShort: 2 })
      const cut = yield* Transcribe.transcript(deps(filtered.http), twice)
      expect(filtered.prompts).toHaveLength(2)
      expect(cut).toContain("- 1 of 1 part(s) are missing or stopped partway.")
      expect(cut).toContain(
        "[00:00:01] 화자 1: 규제 특\n(확인 필요: 모델이 이 구간을 끝까지 받아쓰지 않고 멈췄습니다(content_filter). 뒷부분이 빠졌을 수 있습니다.)",
      )
      expect(yield* Transcribe.existing({ fs, global }, twice)).toBeUndefined()
    }),
  )
})

describe("Transcribe.boundaries", () => {
  test("ends each part of at most 5 minutes in the last quiet moment before the limit", () => {
    expect(
      Transcribe.boundaries(
        recording(650, [
          [290, 290.2],
          [585, 585.3],
        ]),
      ),
    ).toEqual([4_642_400, 9_363_200, 10_400_000])
  })

  test("keeps a recording of 5 minutes or less whole", () => {
    expect(Transcribe.boundaries(recording(300))).toEqual([300 * RATE])
  })
})

describe("Transcribe.normalize", () => {
  test("turns second ranges with zero-based speakers into clock lines numbered from 1", () => {
    expect(Transcribe.normalize("0.13-1.72 | SPEAKER_00: 안녕하세요.\n65.4-70 | SPEAKER_01: 네.", 300)).toBe(
      "[00:05:00] 화자 1: 안녕하세요.\n[00:06:05] 화자 2: 네.",
    )
  })

  test("keeps the first real time when a line carries several", () => {
    expect(
      Transcribe.normalize(
        [
          "[00:05] 화자 1: 시작합니다.",
          "00:00-00:08 [00:12] 화자 2: 좋습니다.",
          "[00:20] [00:00:00] 화자 1: 다음 안건입니다.",
          "[00:00:31.50] 화자 2: 네.",
        ].join("\n"),
        0,
      ),
    ).toBe(
      [
        "[00:00:05] 화자 1: 시작합니다.",
        "[00:00:00] 화자 2: 좋습니다.",
        "[00:00:20] 화자 1: 다음 안건입니다.",
        "[00:00:31] 화자 2: 네.",
      ].join("\n"),
    )
  })

  test("gives a time on its own line to the next words and drops a copied placeholder", () => {
    expect(
      Transcribe.normalize(
        ["00:00-00:04", "[mm:ss] 화자 1: 액체 주석.", "00:06-00:34", "[mm:ss] 화자 2: 네, 맞습니다."].join("\n"),
        60,
      ),
    ).toBe(["[00:01:00] 화자 1: 액체 주석.", "[00:01:06] 화자 2: 네, 맞습니다."].join("\n"))
  })

  test("continues the last time for plain lines, skips code fences, and leaves times inside words alone", () => {
    expect(
      Transcribe.normalize(
        ["```", "[01:02:03] 화자 1: 첫 줄", "이어지는 말", "12:30에 다시 모입니다.", "```"].join("\n"),
        0,
      ),
    ).toBe(["[01:02:03] 화자 1: 첫 줄", "[01:02:03] 이어지는 말", "[01:02:03] 12:30에 다시 모입니다."].join("\n"))
  })

  test("marks Chinese characters and a time past the part's end, allowing a rounded last time", () => {
    expect(
      Transcribe.normalize(
        ["[00:10] 화자 1: 초광역 特区입니다.", "[05:20] 화자 2: 왜 비용이 이만큼인가요?", "[05:01] 화자 1: 네."].join(
          "\n",
        ),
        300,
        299.5,
      ),
    ).toBe(
      [
        "[00:05:10] 화자 1: 초광역 特区입니다. (확인 필요: 한자·중국어가 섞임)",
        "[00:10:20] 화자 2: 왜 비용이 이만큼인가요? (확인 필요: 구간 길이를 넘는 시간)",
        "[00:10:01] 화자 1: 네.",
      ].join("\n"),
    )
  })
})
