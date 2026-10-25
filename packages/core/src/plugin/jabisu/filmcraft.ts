export * as FilmCraft from "./filmcraft.js"

import { FSUtil } from "@opencode/util/fs-util"
import { Effect } from "effect"
import path from "path"
import launcherTemplate from "./craft/start-filmcraft.ps1" with { type: "text" }

// 자비수 drives a running FilmCraft through its CLI's MCP server in bridge mode. FilmCraft opens its control server
// only with `--control <port>` and a FILMCRAFT_CONTROL_TOKEN of 64 hex characters, and the bridge must send the same
// token, so 자비수 keeps one token in its data folder for both.

/** The control port the launcher starts FilmCraft on and the MCP server connects to. */
export const PORT = 47830

const TOKEN = /^[0-9a-f]{64}$/

/** Where FilmCraft installs its command-line tool. */
export const cli = (programFiles: string) => path.join(programFiles, "FilmCraft", "filmcraft-cli.exe")

/** The token file under 자비수's data folder. */
export const tokenFile = (data: string) => path.join(data, "jabisu", "filmcraft-control-token")

/** The control token, made on first use and kept, so a FilmCraft started earlier still accepts the bridge. */
export const token = Effect.fn("FilmCraft.token")(function* (fs: FSUtil.Interface, file: string) {
  const kept = (yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined)))?.trim()

  if (kept && TOKEN.test(kept)) return kept
  const made = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")

  yield* fs.writeWithDirs(file, made)

  return made
})

/** The MCP server for a running FilmCraft. It stays off until the user turns it on. */
export const server = (command: string, token: string) => ({
  type: "local" as const,
  command: [command, "mcp", "--bridge", `127.0.0.1:${PORT}`],
  environment: { FILMCRAFT_CONTROL_TOKEN: token },
  disabled: true,
})

/** The launcher script, which starts FilmCraft with the port and reads the token from its file. */
export const launcher = (file: string) =>
  launcherTemplate.replaceAll("__PORT__", String(PORT)).replaceAll("__TOKEN_FILE__", file.replaceAll("'", "''"))
