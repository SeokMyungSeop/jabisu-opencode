import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const DEFAULT_MODEL = "xiaomi/mimo-v2.6-flash"

// The settings route falls back to this variable when OpenRouter has no stored connection.
const withoutOpenRouterKey = Effect.acquireRelease(
  Effect.sync(() => {
    const previous = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    return previous
  }),
  (previous) =>
    Effect.sync(() => {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = previous
    }),
)

const setup = Effect.gen(function* () {
  yield* withoutOpenRouterKey
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-jabisu-settings-")))
  const global = path.join(tmp.path, "global")
  const project = path.join(tmp.path, "project")
  yield* Effect.promise(() =>
    Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
  )
  const server = yield* startServer(global)
  const url = new URL("/api/jabisu/transcription", server.base)
  url.searchParams.set("location[directory]", project)
  const call = (body?: object) =>
    Effect.promise(async () => {
      const response = await fetch(url, {
        method: body ? "PUT" : "GET",
        headers: { ...server.headers, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
      return { status: response.status, body: await response.json() }
    })
  return { file: path.join(global, "jabisu.json"), call }
})

it.live("reports transcription off with the default model until OpenRouter is connected", () =>
  Effect.gen(function* () {
    const { file, call } = yield* setup

    expect(yield* call()).toEqual({
      status: 200,
      body: { enabled: false, model: DEFAULT_MODEL, defaultModel: DEFAULT_MODEL, openrouter: false },
    })
    const refused = yield* call({ enabled: true })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ kind: "jabisu_transcription" })
    expect(
      yield* Effect.promise(() =>
        fs.stat(file).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false)
  }),
)

it.live("saves the choice beside the other settings and leaves the default model unsaved", () =>
  Effect.gen(function* () {
    const { file, call } = yield* setup
    yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ other: { kept: true } })))
    process.env.OPENROUTER_API_KEY = "test-key"

    expect(yield* call({ enabled: true, model: " other/model " })).toEqual({
      status: 200,
      body: { enabled: true, model: "other/model", defaultModel: DEFAULT_MODEL, openrouter: true },
    })
    expect(JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8")))).toEqual({
      other: { kept: true },
      transcription: { enabled: true, model: "other/model" },
    })

    yield* call({ enabled: false, model: DEFAULT_MODEL })
    expect(JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8")))).toEqual({
      other: { kept: true },
      transcription: { enabled: false },
    })
  }),
)

// The 집현전 root follows the home directory, which tests point at a temporary one.
const withHome = (home: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.OPENCODE_TEST_HOME
        else process.env.OPENCODE_TEST_HOME = previous
      }),
  )

it.live("makes, lists and instructs a 집현전 in the home's documents", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-jabisu-jiphyeonjeon-")))
    yield* withHome(tmp.path)
    yield* withoutOpenRouterKey
    const server = yield* startServer(path.join(tmp.path, "config"))
    const root = path.join(tmp.path, "Documents", "자비수 집현전")
    const call = (method: string, route: string, body?: object) =>
      Effect.promise(async () => {
        const response = await fetch(new URL(route, server.base), {
          method,
          headers: { ...server.headers, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        })
        return { status: response.status, body: await response.json() }
      })

    expect(yield* call("POST", "/api/jabisu/jiphyeonjeon", { name: "회의" })).toEqual({
      status: 200,
      body: { name: "회의", directory: path.join(root, "회의"), instructions: "", sources: [] },
    })
    yield* Effect.promise(() => fs.writeFile(path.join(root, "회의", "자료", "안건.txt"), "예산\n"))
    expect(
      (yield* call("PUT", "/api/jabisu/jiphyeonjeon/instructions", { name: "회의", instructions: "짧게" })).body,
    ).toEqual({
      name: "회의",
      directory: path.join(root, "회의"),
      instructions: "짧게",
      sources: ["안건.txt"],
    })
    expect((yield* call("GET", "/api/jabisu/jiphyeonjeon")).body).toEqual({
      root,
      items: [{ name: "회의", directory: path.join(root, "회의"), instructions: "짧게", sources: ["안건.txt"] }],
      openrouter: false,
      suggestModel: "xiaomi/mimo-v2.6-flash",
    })
    expect(yield* call("GET", `/api/jabisu/jiphyeonjeon/sources?name=${encodeURIComponent("회의")}`)).toEqual({
      status: 200,
      body: [{ path: "안건.txt", status: "ready" }],
    })
    const refused = yield* call("POST", "/api/jabisu/jiphyeonjeon", { name: "a/b" })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ kind: "jabisu_jiphyeonjeon" })

    // Instructions are written from the sources, so an empty 집현전 is refused before any model is asked.
    yield* call("POST", "/api/jabisu/jiphyeonjeon", { name: "빈 곳" })
    const empty = yield* call("POST", "/api/jabisu/jiphyeonjeon/suggest", { name: "빈 곳" })
    expect(empty.status).toBe(400)
    expect(empty.body).toMatchObject({ kind: "jabisu_jiphyeonjeon" })

    // OpenRouter is used only when it is connected; asking for it without a key says so.
    const unconnected = yield* call("POST", "/api/jabisu/jiphyeonjeon/suggest", { name: "회의", openrouter: true })
    expect(unconnected.status).toBe(400)
    expect(unconnected.body).toMatchObject({ message: "OpenRouter is not connected; connect it in Settings → Providers" })
  }),
)
