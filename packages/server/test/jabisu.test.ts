import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { WorkIndex } from "@opencode/core/plugin/jabisu/work/index"
import { WorkProfile } from "@opencode/core/plugin/jabisu/work/profile"
import { Global } from "@opencode/util/global"
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

it.live("copies a bundled skill for the user, and moves the copy aside to use the bundled skill again", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-jabisu-skills-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    yield* Effect.promise(() =>
      Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
    )
    const server = yield* startServer(global)
    const request = (route: string, body?: object) =>
      Effect.promise(async () => {
        const url = new URL(route, server.base)
        url.searchParams.set("location[directory]", project)
        const response = await fetch(url, {
          method: body ? "POST" : "GET",
          headers: { ...server.headers, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        })
        return { status: response.status, body: await response.json() }
      })
    const status = (list: { skills: { name: string; status: string }[] }, name: string) =>
      list.skills.find((skill) => skill.name === name)?.status

    const listed = yield* request("/api/jabisu/skills")
    expect(listed.status).toBe(200)
    expect(listed.body.folder).toBe(path.join(global, "skills"))
    expect(status(listed.body, "docx")).toBe("default")

    const copied = yield* request("/api/jabisu/skills/copy", { name: "docx" })
    expect(status(copied.body, "docx")).toBe("custom")
    expect(yield* Effect.promise(() => fs.readFile(path.join(global, "skills", "docx", "SKILL.md"), "utf8"))).toContain(
      "name: docx",
    )
    expect((yield* request("/api/jabisu/skills/copy", { name: "docx" })).body).toMatchObject({ kind: "jabisu_skills" })

    const reset = yield* request("/api/jabisu/skills/reset", { name: "docx" })
    expect(reset.body.backup.startsWith(path.join(global, "skills-backup", "docx-"))).toBe(true)
    expect(status(reset.body.list, "docx")).toBe("default")
  }),
)

it.live("indexes 자비수's work folder and the folders the user chooses, and reports their coverage", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-jabisu-work-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    const home = path.join(tmp.path, "home")
    const jabisu = WorkProfile.folder({ home })
    const folder = path.join(tmp.path, "업무")
    yield* withHome(home)
    yield* Effect.promise(() =>
      Promise.all([
        fs.mkdir(global, { recursive: true }),
        fs.mkdir(project, { recursive: true }),
        fs.mkdir(jabisu, { recursive: true }),
        fs.mkdir(folder, { recursive: true }),
      ]),
    )
    yield* Effect.promise(() => fs.writeFile(path.join(jabisu, "사무분장.txt"), "바이오산업팀 사무분장"))
    yield* Effect.promise(() => fs.writeFile(path.join(folder, "실증사업 계획.txt"), "디지털헬스케어 실증사업 추진 계획"))
    // The test server keeps the real data folder, so the index this config makes there is removed after the server.
    const index = WorkIndex.file(Global.make({ config: global }))
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        Promise.all(["", "-wal", "-shm"].map((suffix) => fs.rm(`${index}${suffix}`, { force: true }))),
      ),
    )
    const server = yield* startServer(global)
    const request = (body?: object) =>
      Effect.promise(async () => {
        const url = new URL("/api/jabisu/work", server.base)
        url.searchParams.set("location[directory]", project)
        const response = await fetch(url, {
          method: body ? "PUT" : "GET",
          headers: { ...server.headers, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        })
        return { status: response.status, body: await response.json() }
      })

    const before = yield* request()
    expect(before.body.jabisu.path).toBe(jabisu)
    expect(before.body).toMatchObject({ received: [], saved: [], profile: { exists: false } })
    expect(path.dirname(before.body.profile.path)).toBe(jabisu)

    const refused = yield* request({ received: [path.join(tmp.path, "없는 폴더")], saved: [] })
    expect(refused.status).toBe(400)

    const chosen = yield* request({ received: [], saved: [folder] })
    expect(chosen.body.saved.map((item: { path: string }) => item.path)).toEqual([folder])

    // The indexer looks at the settings every two seconds and then reads the documents' text.
    let indexed = { jabisu: { ready: 0 }, saved: [{ ready: 0 }] }
    for (let attempt = 0; attempt < 40 && (indexed.jabisu.ready === 0 || indexed.saved[0]?.ready === 0); attempt++) {
      yield* Effect.sleep("250 millis")
      indexed = (yield* request()).body
    }
    expect(indexed.jabisu).toMatchObject({ path: jabisu, files: 1, documents: 1, ready: 1, pending: 0 })
    expect(indexed.saved[0]).toMatchObject({ path: folder, files: 1, documents: 1, ready: 1, pending: 0 })
  }),
)
