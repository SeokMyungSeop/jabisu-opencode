import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

// The 작업실 root follows the home directory, which the test points at a temporary one.
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

const exists = (target: string) =>
  Effect.promise(() =>
    fs.stat(target).then(
      () => true,
      () => false,
    ),
  )

it.live("renames a 작업실 with its folder, and its conversation follows it", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-jabisu-workroom-")))
    yield* withHome(tmp.path)
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { directory: path.join(tmp.path, "config") },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const call = (method: string, route: string, body?: object) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(new URL(route, "http://opencode.local"), {
            method,
            headers: { "content-type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
          }),
        )
        const text = await response.text()
        return { status: response.status, body: text ? JSON.parse(text) : undefined }
      })
    const root = path.join(tmp.path, "Documents", "자비수 작업실")

    const made = yield* call("POST", "/api/jabisu/workroom", { text: "내용 정리해 줘", files: [] })
    expect(made.body).toEqual({ directory: path.join(root, "내용"), name: "내용" })
    const created = yield* call("POST", "/api/session", { title: "회의", location: { directory: made.body.directory } })
    expect(created.status).toBe(200)
    const conversation = created.body.data.id
    yield* Effect.promise(() => fs.writeFile(path.join(made.body.directory, "메모.txt"), "예산\n"))
    yield* Effect.promise(() => fs.mkdir(path.join(root, "보고서")))

    const rename = (directory: string, name: string) =>
      call("POST", "/api/jabisu/workroom/rename", { directory, name })
    expect(yield* rename(made.body.directory, "보고서")).toMatchObject({
      status: 400,
      body: { kind: "jabisu_workroom_taken" },
    })
    expect(yield* rename(made.body.directory, "a/b")).toMatchObject({
      status: 400,
      body: { kind: "jabisu_workroom_name" },
    })
    expect(yield* rename(path.join(tmp.path, "elsewhere"), "남의 폴더")).toMatchObject({
      status: 400,
      body: { kind: "jabisu_workroom_not_owned" },
    })

    const renamed = yield* rename(made.body.directory, "  초광역특구 설명회. ")
    const target = path.join(root, "초광역특구 설명회")
    expect(renamed).toEqual({ status: 200, body: { directory: target, name: "초광역특구 설명회" } })
    expect(yield* exists(made.body.directory)).toBe(false)
    expect(yield* Effect.promise(() => fs.readFile(path.join(target, "메모.txt"), "utf8"))).toBe("예산\n")
    expect((yield* call("GET", `/api/session/${conversation}`)).body.data.location.directory).toBe(target)

    // Throwing a 작업실 away starts on the server, which lets go of the folder; the desktop moves it to the bin.
    expect((yield* call("POST", "/api/jabisu/workroom/release", { directory: target })).status).toBe(204)
    expect(
      yield* call("POST", "/api/jabisu/workroom/release", { directory: made.body.directory }),
    ).toMatchObject({ status: 400, body: { kind: "jabisu_workroom_missing" } })
  }).pipe(Effect.scoped),
)
