import fs from "fs/promises"
import net from "node:net"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Money } from "@opencode/schema/money"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { filesystem } from "@opencode/util/effect/app-node-platform"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { DevServerLaunch } from "@opencode/core/tool/plugin/devserver-launch"
import { DevServerTool } from "@opencode/core/tool/plugin/devserver"
import { Tool } from "@opencode/core/tool"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity, type ToolExecution } from "./lib/tool"

const sessionID = Session.ID.make("ses_devserver_tool_test")
const sessionModel = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })
const assertions: Permission.AssertInput[] = []
let denyAction: string | undefined

const permission = permissionLayer({
  assert: (input) =>
    Effect.sync(() => assertions.push(input)).pipe(
      Effect.andThen(
        input.action === denyAction
          ? Effect.fail(
              new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources }),
            )
          : Effect.void,
      ),
    ),
})

const reset = () => {
  assertions.length = 0
  denyAction = undefined
}

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const complete = Effect.fn("DevServerTest.complete")(function* (id: Session.ID) {
        const session = yield* store.get(id)
        if (!session) return
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: id,
          assistantMessageID,
          agent: session.agent ?? Agent.ID.make("code"),
          model: sessionModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID: id,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: complete,
        wake: () => Effect.void,
        interrupt: () => Effect.succeed(false),
        awaitIdle: (id) => complete(id).pipe(Effect.exit, Effect.asVoid),
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

const pluginSupervisor = makeLocationNode({
  name: "test/devserver-plugins",
  layer: Layer.effectDiscard(registerToolPlugin(DevServerTool.Plugin)),
  deps: [
    Config.node,
    Environment.node,
    FileAccess.node,
    FSUtil.node,
    Location.node,
    Permission.node,
    Shell.node,
    ShellSelect.node,
    Tool.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  LocationServiceMap.node,
  filesystem,
  FSUtil.node,
  Global.node,
])
const it = testEffect(
  AppNodeBuilder.build(nodes, [
    SessionExecution.node.replace(executionNode),
    Permission.node.replace(permission),
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    PluginSupervisor.node.replace(pluginSupervisor),
  ]),
)

const withSession = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    yield* sessions.create({ id: sessionID, title: "devserver test", location, model: sessionModel })
    const locations = yield* LocationServiceMap.Service
    return yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      return yield* body(yield* Tool.Service)
    }).pipe(Effect.provide(locations.get(location)), Effect.ensuring(locations.invalidate(location)))
  })

// The tools are CodeMode tools, so calls go through `execute` exactly as a model's would.
const call = (registry: Tool.Interface, name: string, input: Record<string, unknown>) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: `call-${name}-${crypto.randomUUID()}`,
      name: "execute",
      input: { code: `return await tools.devserver.${name}(${JSON.stringify(input)})` },
    },
  })

const text = (result: ToolExecution) => (result.content?.[0]?.type === "text" ? result.content[0].text : "")
const json = (result: ToolExecution) => JSON.parse(text(result))
const failed = (result: ToolExecution) => result.status === "error" || result.metadata?.error === true

const fixture = (files: Record<string, string>) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const tmp = await tmpdir()
      await Promise.all(
        Object.entries(files).map(async ([file, content]) => {
          await fs.mkdir(path.dirname(path.join(tmp.path, file)), { recursive: true })
          await Bun.write(path.join(tmp.path, file), content)
        }),
      )
      return tmp
    }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
  )

const launch = (...configurations: Record<string, unknown>[]) => JSON.stringify({ version: "0.0.1", configurations })

const SERVER = [
  "Bun.serve({ port: Number(process.env.PORT), hostname: '127.0.0.1', fetch: () => new Response(`hello ${process.env.GREETING}`) })",
  "console.log(`listening on ${process.env.PORT}`)",
].join("\n")

const bun = { runtimeExecutable: process.execPath, program: "server.ts" }

const reachable = (url: string) =>
  Effect.promise(() =>
    fetch(url)
      .then((response) => response.text())
      .catch(() => undefined),
  )

const occupy = Effect.acquireRelease(
  Effect.callback<net.Server>((resume) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
  }),
  (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void))),
)

describe("DevServerTool", () => {
  it.live(
    "starts, reuses, reads, and stops a configured server",
    () =>
      Effect.gen(function* () {
        reset()
        const tmp = yield* fixture({
          "server.ts": SERVER,
          ".opencode/launch.json": launch({ name: "web", ...bun, autoPort: true, env: { GREETING: "devserver" } }),
        })
        yield* withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const started = json(yield* call(registry, "start", { name: "web" }))
            expect(started).toMatchObject({ name: "web", status: "running", url: `http://localhost:${started.port}` })
            expect(yield* reachable(`http://127.0.0.1:${started.port}`)).toBe("hello devserver")
            expect(assertions.map((item) => item.action)).toEqual(["shell"])

            expect(json(yield* call(registry, "start", { name: "web" }))).toEqual(started)
            expect(assertions).toHaveLength(1)
            expect(json(yield* call(registry, "list", {})).servers).toEqual([started])
            expect(json(yield* call(registry, "logs", { name: "web" })).output).toContain(
              `listening on ${started.port}`,
            )

            expect(json(yield* call(registry, "stop", { name: "web" }))).toEqual({ name: "web", status: "stopped" })
            expect(yield* reachable(`http://127.0.0.1:${started.port}`)).toBeUndefined()
            expect(json(yield* call(registry, "list", {})).servers).toEqual([{ name: "web", status: "stopped" }])
          }),
        )
      }).pipe(Effect.scoped),
    { timeout: 60_000 },
  )

  it.live(
    "fails with the server output when it exits before listening",
    () =>
      Effect.gen(function* () {
        reset()
        const tmp = yield* fixture({
          "server.ts": "console.log('boom before listening')\nprocess.exit(3)",
          ".opencode/launch.json": launch({ name: "web", ...bun, autoPort: true }),
        })
        const result = yield* withSession(tmp.path, (registry) => call(registry, "start", { name: "web" }))
        expect(failed(result)).toBe(true)
        expect(text(result)).toContain("exited before port")
        expect(text(result)).toContain("boom before listening")
      }).pipe(Effect.scoped),
    { timeout: 60_000 },
  )

  it.live(
    "spawns nothing when shell permission is denied",
    () =>
      Effect.gen(function* () {
        reset()
        denyAction = "shell"
        const tmp = yield* fixture({
          "server.ts": SERVER,
          ".opencode/launch.json": launch({ name: "web", ...bun, autoPort: true }),
        })
        yield* withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const result = yield* call(registry, "start", { name: "web" })
            expect(failed(result)).toBe(true)
            expect(assertions.map((item) => item.action)).toEqual(["shell"])
            const shell = yield* Shell.Service
            expect(yield* shell.list()).toEqual([])
          }),
        )
      }).pipe(Effect.scoped),
    { timeout: 60_000 },
  )

  it.live(
    "refuses a busy port unless autoPort is set",
    () =>
      Effect.gen(function* () {
        reset()
        const busy = yield* occupy
        const address = busy.address()
        const port = address && typeof address === "object" ? address.port : 0
        const tmp = yield* fixture({
          "server.ts": SERVER,
          ".opencode/launch.json": launch({ name: "web", ...bun, port }),
        })
        const result = yield* withSession(tmp.path, (registry) => call(registry, "start", { name: "web" }))
        expect(failed(result)).toBe(true)
        expect(text(result)).toContain(`Port ${port} is already in use`)
        expect(assertions).toEqual([])
      }).pipe(Effect.scoped),
    { timeout: 60_000 },
  )

  it.live(
    "attaches to a url from .claude/launch.json and explains unknown names",
    () =>
      Effect.gen(function* () {
        reset()
        const tmp = yield* fixture({
          ".claude/launch.json": launch({ name: "remote", url: "http://localhost:4321" }, { name: "other", ...bun }),
        })
        yield* withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect(json(yield* call(registry, "start", { name: "remote" }))).toEqual({
              name: "remote",
              status: "attached",
              url: "http://localhost:4321",
            })
            const missing = yield* call(registry, "start", { name: "nope" })
            expect(text(missing)).toContain('No configuration named "nope"')
            expect(text(missing)).toContain("Available: remote, other.")
            expect(assertions).toEqual([])
          }),
        )
      }).pipe(Effect.scoped),
    { timeout: 60_000 },
  )
})

describe("DevServerLaunch.commandLine", () => {
  const config = (input: Partial<DevServerLaunch.Configuration>) => ({ name: "web", ...input })

  test("leaves plain commands unquoted so saved approvals still match", () => {
    expect(DevServerLaunch.commandLine(config({ runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }), "bash")).toBe(
      "npm run dev",
    )
  })

  test("defaults the runtime to node for a program", () => {
    expect(DevServerLaunch.commandLine(config({ program: "server.js", args: ["--port", "3000"] }), "bash")).toBe(
      "node server.js --port 3000",
    )
  })

  test("quotes per shell", () => {
    const spaced = config({ runtimeExecutable: "C:\\Program Files\\nodejs\\node.exe", program: "it's.js" })
    expect(DevServerLaunch.commandLine(spaced, "C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
      "& 'C:\\Program Files\\nodejs\\node.exe' 'it''s.js'",
    )
    expect(DevServerLaunch.commandLine(spaced, "C:\\Windows\\System32\\cmd.exe")).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" "it\'s.js"',
    )
    expect(DevServerLaunch.commandLine(spaced, "/bin/bash")).toBe("'C:\\Program Files\\nodejs\\node.exe' 'it'\\''s.js'")
  })

  test("quotes backslash paths for POSIX shells but not for PowerShell", () => {
    const windows = config({ runtimeExecutable: "C:\\tools\\bun\\bun.exe", program: "server.ts" })
    expect(DevServerLaunch.commandLine(windows, "/usr/bin/bash")).toBe("'C:\\tools\\bun\\bun.exe' server.ts")
    expect(DevServerLaunch.commandLine(windows, "powershell")).toBe("C:\\tools\\bun\\bun.exe server.ts")
  })
})
