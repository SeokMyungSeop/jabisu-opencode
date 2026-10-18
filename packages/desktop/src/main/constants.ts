import { app } from "electron"
import os from "node:os"
import path from "node:path"

// `jabisu` is 자비수(諮備秀), a renamed redistribution of this app by 명상(明想).
type Channel = "local" | "dev" | "beta" | "prod" | "jabisu"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel =
  raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" || raw === "jabisu" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
  jabisu: "자비수",
}

const appIDs: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
  jabisu: "io.github.seokmyungseop.jabisu",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "OpenCode Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.opencode.desktop.dev"

/** A redistribution installs beside OpenCode, so it leaves OpenCode's `opencode://` links to OpenCode. */
export const REDISTRIBUTION = CHANNEL === "jabisu"

/**
 * The registration file of a redistribution's background service. OpenCode's channels share the CLI's default file; a
 * redistribution's CLI registers under its channel name, so the app must look there or it would adopt, or replace,
 * an OpenCode service running on the same machine.
 */
export function redistributionServiceFile() {
  if (!REDISTRIBUTION) return
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")

  return path.join(state, "opencode", `service-${CHANNEL}.json`)
}
