// What the console runs with: its ports and folder, the OpenRouter key file, the paid model it falls back to, and the
// limits. <home>/settings.json may override any of them; the key itself never lives in the settings.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface Limits {
  /** Won of paid use allowed on each of the first days, from the first day of use on. */
  readonly trialDays: readonly number[]
  /** Won of paid use allowed on every day after those; 0 ends the trial instead. */
  readonly afterTrialKrw: number
  /** Requests answered by free models per install per day: during the first days, and on every day after them. */
  readonly freeRequestsPerDay: number
  readonly afterTrialFreeRequests: number
  /** Messages the person sends (not the AI's tool steps) per install per hour. */
  readonly questionsPerHour: number
  /** Won of paid use per network address per day, so new installs from one place cannot each take a full share. */
  readonly ipDailyKrw: number
  /** Won of paid use for the whole console per day and per month. */
  readonly dailyKrw: number
  readonly monthlyKrw: number
  /** Free requests left on the OpenRouter account below which the console stops using free models. */
  readonly freeReserve: number
}

export interface Settings {
  readonly publicPort: number
  readonly adminPort: number
  readonly home: string
  readonly keyFile: string
  readonly upstream: string
  /** The paid model every chain ends with. */
  readonly paidModel: string
  /** How many free models a chain holds before the paid one. */
  readonly freeModels: number
  /** The context and output the app is told the model has. */
  readonly context: number
  readonly output: number
  /** Free models narrower than this are not tried. */
  readonly minContext: number
  /** Models the check never uses, and models it always puts first when they pass. */
  readonly exclude: readonly string[]
  readonly prefer: readonly string[]
  /** The version of the notice people agreed to in the app; an older one has to be agreed again. */
  readonly consentVersion: string
  readonly krwPerUsd: number
  readonly limits: Limits
}

export const defaults = (home: string): Settings => ({
  publicPort: 4317,
  adminPort: 4318,
  home,
  keyFile: path.join(home, "openrouter-key.txt"),
  upstream: "https://openrouter.ai/api/v1",
  paidModel: "deepseek/deepseek-v4.1-flash",
  freeModels: 2,
  context: 400_000,
  output: 32_000,
  minContext: 128_000,
  exclude: [],
  prefer: [],
  consentVersion: "1",
  krwPerUsd: 1400,
  limits: {
    trialDays: [300, 200, 100, 100, 100, 100, 100],
    afterTrialKrw: 50,
    afterTrialFreeRequests: 30,
    freeRequestsPerDay: 100,
    questionsPerHour: 10,
    ipDailyKrw: 1000,
    dailyKrw: 1600,
    monthlyKrw: 50_000,
    freeReserve: 50,
  },
})

/** The settings for a console folder: the defaults, then <home>/settings.json, then the key file from the environment. */
export function load(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Settings {
  // Windows keeps it under Local AppData; Linux (WSL beside the Cloudflare tunnel) in a dot folder at home.
  const home =
    env.JABISU_CONSOLE_HOME ??
    (platform === "win32"
      ? path.join(env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? os.homedir(), "AppData", "Local"), "jabisu-console")
      : path.join(env.HOME ?? os.homedir(), ".jabisu-console"))
  const base = defaults(home)
  const file = path.join(home, "settings.json")
  const own: Partial<Settings> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}

  return {
    ...base,
    ...own,
    home,
    keyFile: env.JABISU_CONSOLE_KEY_FILE ?? own.keyFile ?? base.keyFile,
    limits: { ...base.limits, ...own.limits },
  }
}
