// Starts 자비수 무료 LLM 콘솔 on 명상's PC: the public endpoint the Cloudflare tunnel exposes and the admin page, both on
// 127.0.0.1. The OpenRouter key is read from its file and only ever sent to OpenRouter.
import fs from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { adminHandler, type Account } from "./admin.ts"
import { check, type Listed } from "./models.ts"
import { handler, NAME } from "./proxy.ts"
import { load } from "./settings.ts"
import { open } from "./store.ts"

const settings = load()
fs.mkdirSync(settings.home, { recursive: true })
const log = (line: string) =>
  console.log(`${new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} ${line}`)

if (!fs.existsSync(settings.keyFile)) {
  console.error(
    `OpenRouter 키 파일이 없어요: ${settings.keyFile}\n메모장으로 이 파일을 만들고 무료 콘솔 전용 키 한 줄만 넣어 저장한 뒤 다시 실행하세요.`,
  )
  process.exit(1)
}
const key = fs.readFileSync(settings.keyFile, "utf8").trim()
const store = open(path.join(settings.home, "console.db"))

let chain: readonly string[] = store.lastCheck()?.chain ?? []
let account: Account | undefined
let checking = false
let failures: number[] = []

const headers = {
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
  "HTTP-Referer": "https://github.com/SeokMyungSeop/jabisu-opencode",
  "X-Title": "Jabisu",
}

const post = async (body: Record<string, unknown>, timeout: number) => {
  const response = await fetch(`${settings.upstream}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await response.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: response.status, json, text: text.slice(0, 300) }
}

const runCheck = async () => {
  if (checking) return
  checking = true
  try {
    const listed = (await fetch(`${settings.upstream}/models`, { signal: AbortSignal.timeout(60_000) }).then((r) =>
      r.json(),
    )) as {
      data?: Listed[]
    }
    const result = await check(listed.data ?? [], settings, post)
    store.saveCheck(result)
    chain = result.chain
    failures = []
    log(
      `모델 점검: 후보 ${result.log.length}개, 통과 ${result.log.filter((e) => e.ok).length}개 → ${chain.join(" → ") || "무료 없음"}`,
    )
  } catch (error) {
    log(`모델 점검 실패: ${String(error).slice(0, 200)}`)
  } finally {
    checking = false
  }
}

const readAccount = async () => {
  try {
    const data = (
      (await fetch(`${settings.upstream}/key`, { headers, signal: AbortSignal.timeout(30_000) }).then((r) =>
        r.json(),
      )) as {
        data?: Record<string, any>
      }
    ).data
    if (!data) return
    account = {
      limitRemaining: data.limit_remaining ?? undefined,
      usageDaily: data.usage_daily,
      usageMonthly: data.usage_monthly,
      freeLeft: data.free_model_daily_requests?.remaining,
      checked: Date.now(),
    }
  } catch {}
}

// Three failures within ten minutes start a new check, at most every half hour.
const failed = (status: number) => {
  const now = Date.now()
  failures = [...failures.filter((time) => now - time < 600_000), now]
  log(`OpenRouter 실패 ${status}`)
  const last = store.lastCheck()?.time ?? 0
  if (failures.length >= 3 && now - last > 1_800_000) void runCheck()
}

const isOpen = () => store.get("open") !== "0"

const publicServer = createServer(
  handler({
    settings,
    store,
    key: () => key,
    chain: () => chain,
    freeLeft: () => account?.freeLeft,
    open: isOpen,
    failed,
    log,
  }),
)
const adminServer = createServer(
  adminHandler({
    settings,
    store,
    chain: () => chain,
    account: () => account,
    open: isOpen,
    setOpen: (value) => {
      store.set("open", value ? "1" : "0")
      log(value ? "창구 열림" : "창구 닫힘")
    },
    runCheck: () => void runCheck(),
    checking: () => checking,
  }),
)

publicServer.listen(settings.publicPort, "127.0.0.1", () =>
  log(`${NAME}: http://127.0.0.1:${settings.publicPort} (터널로 공개)`),
)
adminServer.listen(settings.adminPort, "127.0.0.1", () => log(`관리 화면: http://127.0.0.1:${settings.adminPort}`))

void readAccount()
setInterval(() => void readAccount(), 300_000)
if (Date.now() - (store.lastCheck()?.time ?? 0) > 20 * 3_600_000) void runCheck()
setInterval(() => void runCheck(), 24 * 3_600_000)

const stop = () => {
  publicServer.close()
  adminServer.close()
  store.close()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
