export * as DevServerTool from "./devserver.js"

import net from "node:net"
import path from "path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Duration, Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { NonNegativeInt } from "../../schema.js"
import { Shell } from "../../shell.js"
import { ShellSelect } from "../../shell/select.js"
import { DevServerLaunch } from "./devserver-launch.js"
import { ShellTool } from "./shell.js"

export const namespace = "devserver"
export const DEFAULT_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 5_000
const POLL = Duration.millis(250)

const Name = Schema.String.annotate({ description: "Configuration name from launch.json" })

export const StartInput = Schema.Struct({
  name: Name,
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Milliseconds to wait for the port to accept connections. Defaults to ${DEFAULT_TIMEOUT_MS}.`,
  }),
})

export const NameInput = Schema.Struct({ name: Name })

export const LogsInput = Schema.Struct({
  name: Name,
  cursor: Schema.optionalKey(NonNegativeInt).annotate({
    description: "Byte offset to read from. Pass the cursor from the previous call to read only new output.",
  }),
})

export const Server = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["stopped", "starting", "running", "attached"]),
  url: Schema.optionalKey(Schema.String),
  port: Schema.optionalKey(Schema.Number),
  shellID: Schema.optionalKey(Schema.String),
})
type Server = typeof Server.Type

const ListOutput = Schema.Struct({
  file: Schema.optionalKey(Schema.String),
  servers: Schema.Array(Server),
})

const LogsOutput = Schema.Struct({
  output: Schema.String,
  cursor: Schema.Number,
  size: Schema.Number,
})

// What a dev server's shell carries in its metadata; it survives plugin reloads because the Shell service owns it.
const Tracked = Schema.Struct({
  devserver: Schema.String,
  port: Schema.optionalKey(Schema.Number),
  url: Schema.optionalKey(Schema.String),
})
const decodeTracked = Schema.decodeUnknownOption(Tracked)

const description = [
  "Start, stop, and inspect the project's dev servers defined in `.opencode/launch.json` (or `.claude/launch.json`).",
  "Each configuration has a name, a command (`runtimeExecutable`, `runtimeArgs`, `program`, `args`), and a `port`, or `autoPort` to pick a free port passed as `PORT`, or a `url` to attach to a server that is already running.",
  "After `start` returns a URL, open it with `browser.tabs.open` to preview the app.",
  "Servers are shared by every session in this directory and keep running until stopped.",
].join(" ")

export const Plugin = {
  id: "opencode.tool.devserver",
  effect: Effect.fn("DevServerTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const authorize = yield* ShellTool.authorizer(ctx.app.channel)

    const tracked = Effect.fn("DevServerTool.tracked")(function* () {
      return (yield* shell.list()).flatMap((info) => {
        const metadata = decodeTracked(info.metadata)
        return metadata._tag === "Some" ? [{ info, ...metadata.value }] : []
      })
    })

    const running = Effect.fn("DevServerTool.running")(function* (name: string) {
      return (yield* tracked()).find((server) => server.devserver === name)
    })

    const configuration = Effect.fn("DevServerTool.configuration")(function* (name: string) {
      const launch = yield* DevServerLaunch.load(fs, location.directory)
      if (!launch)
        return yield* Effect.fail(
          new Error(`No launch.json found. Create .opencode/launch.json in ${location.directory}.`),
        )
      const found = launch.configurations.find((item) => item.name === name)
      if (!found)
        return yield* Effect.fail(
          new Error(
            `No configuration named "${name}" in ${launch.file}. Available: ${launch.configurations.map((item) => item.name).join(", ") || "none"}.`,
          ),
        )
      return found
    })

    const awaitReady = (
      id: Parameters<typeof shell.get>[0],
      port: number,
      deadline: number,
    ): Effect.Effect<"ready" | "exited" | "timeout"> =>
      Effect.gen(function* () {
        if (yield* listening(port)) return "ready" as const
        const info = yield* shell.get(id).pipe(Effect.option)
        if (info._tag === "None" || info.value.status !== "running") return "exited" as const
        if (Date.now() >= deadline) return "timeout" as const
        yield* Effect.sleep(POLL)
        return yield* awaitReady(id, port, deadline)
      })

    const awaitClosed = (port: number, deadline: number): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (!(yield* listening(port))) return true
        if (Date.now() >= deadline) return false
        yield* Effect.sleep(POLL)
        return yield* awaitClosed(port, deadline)
      })

    const start = Effect.fn("DevServerTool.start")(function* (input: typeof StartInput.Type, context: Tool.Context) {
      const existing = yield* running(input.name)
      if (existing)
        return {
          name: input.name,
          status: "running" as const,
          ...(existing.url === undefined ? {} : { url: existing.url }),
          ...(existing.port === undefined ? {} : { port: existing.port }),
          shellID: existing.info.id,
        }
      const config = yield* configuration(input.name)
      if (config.url !== undefined) return { name: input.name, status: "attached" as const, url: config.url }
      if (config.runtimeExecutable === undefined && config.program === undefined)
        return yield* Effect.fail(new Error(`Configuration "${input.name}" needs runtimeExecutable, program, or url.`))
      const port = config.autoPort === true ? yield* freePort : (config.port ?? DevServerLaunch.DEFAULT_PORT)
      if (config.autoPort !== true && (yield* listening(port)))
        return yield* Effect.fail(
          new Error(
            `Port ${port} is already in use. Stop the process using it, set "autoPort": true, or set "url" to attach to the running server.`,
          ),
        )
      const url = `http://localhost:${port}`
      const selected = yield* compatibleShell
      const info = yield* shell.create(
        {
          command: DevServerLaunch.commandLine(config, selected),
          cwd: config.cwd === undefined ? location.directory : path.resolve(location.directory, config.cwd),
          timeout: 0,
          shell: selected,
          metadata: { sessionID: context.sessionID, devserver: input.name, port, url },
        },
        (invocation) =>
          Effect.gen(function* () {
            Object.assign(invocation.env, config.env, { PORT: String(port) })
            yield* authorize(invocation, context)
          }),
      )
      const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
      const state = yield* awaitReady(info.id, port, Date.now() + timeout)
      if (state === "exited") {
        const result = yield* shell.result(info)
        return yield* Effect.fail(
          new Error(
            `Dev server "${input.name}" exited before port ${port} accepted connections.\n${result.capture?.output ?? ""}`,
          ),
        )
      }
      return {
        name: input.name,
        status: state === "ready" ? ("running" as const) : ("starting" as const),
        url,
        port,
        shellID: info.id,
      }
    })

    yield* ctx.tool
      .transform((editor) => {
        editor.namespace({ name: namespace, description })
        editor.add({
          name: "list",
          description: "List the dev server configurations in launch.json and whether each one is running.",
          input: Schema.Struct({}),
          output: ListOutput,
          options: { namespace, codemode: true, permission: "shell" },
          execute: () =>
            Effect.gen(function* () {
              const launch = yield* DevServerLaunch.load(fs, location.directory)
              const active = yield* tracked()
              const servers = (launch?.configurations ?? []).map((config): Server => {
                const server = active.find((item) => item.devserver === config.name)
                if (server)
                  return {
                    name: config.name,
                    status: "running",
                    ...(server.url === undefined ? {} : { url: server.url }),
                    ...(server.port === undefined ? {} : { port: server.port }),
                    shellID: server.info.id,
                  }
                if (config.url !== undefined) return { name: config.name, status: "attached", url: config.url }
                return { name: config.name, status: "stopped" }
              })
              const output = { ...(launch ? { file: launch.file } : {}), servers }
              return {
                output,
                content: launch
                  ? servers
                      .map((server) => `${server.name}: ${server.status}${server.url ? ` ${server.url}` : ""}`)
                      .join("\n") || `${launch.file} has no configurations.`
                  : `No launch.json found. Create .opencode/launch.json in ${location.directory}.`,
              }
            }).pipe(Effect.mapError(failure("Unable to list dev servers"))),
        })
        editor.add({
          name: "start",
          description:
            "Start a dev server from launch.json, or return it if it is already running, and wait until its port accepts connections. Returns the URL to open in the browser.",
          input: StartInput,
          output: Server,
          options: { namespace, codemode: true, permission: "shell" },
          execute: (input, context) =>
            start(input, context).pipe(
              Effect.map((server) => ({
                output: server,
                content: startMessage(server, input.timeout ?? DEFAULT_TIMEOUT_MS),
              })),
              Effect.mapError(failure(`Unable to start dev server "${input.name}"`)),
            ),
        })
        editor.add({
          name: "logs",
          description: "Read a running dev server's combined stdout and stderr.",
          input: LogsInput,
          output: LogsOutput,
          options: { namespace, codemode: true, permission: "shell" },
          execute: (input) =>
            Effect.gen(function* () {
              const server = yield* running(input.name)
              if (!server) return yield* Effect.fail(new Error(`Dev server "${input.name}" is not running.`))
              const page = yield* shell.output(
                server.info.id,
                input.cursor === undefined ? {} : { cursor: input.cursor },
              )
              return {
                output: { output: page.output, cursor: page.cursor, size: page.size },
                content: page.output || "(no new output)",
              }
            }).pipe(Effect.mapError(failure(`Unable to read dev server "${input.name}" logs`))),
        })
        editor.add({
          name: "stop",
          description: "Stop a running dev server and its child processes.",
          input: NameInput,
          output: Server,
          options: { namespace, codemode: true, permission: "shell" },
          execute: (input) =>
            Effect.gen(function* () {
              const server = yield* running(input.name)
              if (!server)
                return {
                  output: { name: input.name, status: "stopped" as const },
                  content: `Dev server "${input.name}" is not running.`,
                }
              yield* shell.remove(server.info.id)
              // Removal kills the process tree asynchronously; wait so an immediate restart finds the port free.
              const closed =
                server.port === undefined ? true : yield* awaitClosed(server.port, Date.now() + STOP_TIMEOUT_MS)
              return {
                output: { name: input.name, status: "stopped" as const },
                content: closed
                  ? `Stopped dev server "${input.name}".`
                  : `Stopped dev server "${input.name}", but port ${server.port} is still accepting connections.`,
              }
            }).pipe(Effect.mapError(failure(`Unable to stop dev server "${input.name}"`))),
        })
      })
      .pipe(Effect.orDie)
  }),
}

// The failure message is all the model sees, so it carries the cause the model needs to fix launch.json or the port.
const failure = (message: string) => (error: { readonly message: string }) =>
  new ToolFailure({ message: `${message}: ${error.message}`, error })

function startMessage(server: Server, timeout: number) {
  if (server.status === "attached")
    return `Dev server "${server.name}" is attached to ${server.url}. Open it with browser.tabs.open to preview.`
  if (server.status === "starting")
    return `Dev server "${server.name}" is running but port ${server.port} did not accept connections within ${timeout} ms. Check devserver.logs, then start it again to keep waiting.`
  return `Dev server "${server.name}" is running at ${server.url} (shell ID: ${server.shellID}). Open it with browser.tabs.open to preview.`
}

// Dev servers may bind IPv4 or IPv6 localhost only, so a port counts as open when either accepts a connection.
const listening = (port: number) =>
  Effect.all([accepts("127.0.0.1", port), accepts("::1", port)], { concurrency: 2 }).pipe(
    Effect.map((results) => results.some(Boolean)),
  )

const accepts = (host: string, port: number) =>
  Effect.callback<boolean>((resume) => {
    const socket = net.connect({ host, port })
    const settle = (value: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resume(Effect.succeed(value))
    }
    socket.once("connect", () => settle(true))
    socket.once("error", () => settle(false))
    socket.setTimeout(1_000, () => settle(false))
    return Effect.sync(() => socket.destroy())
  })

const freePort = Effect.callback<number, Error>((resume) => {
  const server = net.createServer()
  server.once("error", (error) => resume(Effect.fail(error)))
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    const port = address && typeof address === "object" ? address.port : undefined
    server.close(() =>
      resume(port === undefined ? Effect.fail(new Error("Could not find a free port")) : Effect.succeed(port)),
    )
  })
})
