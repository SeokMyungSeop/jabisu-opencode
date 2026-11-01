// The public side of the console, the one the Cloudflare tunnel exposes: an OpenAI-style chat endpoint that only 자비수
// installs which agreed to the notice may use. Each request is checked against the limits, sent to OpenRouter with the
// current free models and then the paid one, passed back as it streams, and counted when it ends.
import type { IncomingMessage, ServerResponse } from "node:http"
import { events, take, type Used } from "./answer.ts"
import { between, day, midnight, month } from "./clock.ts"
import { decide, level, OWN_KEY, type Refusal } from "./limits.ts"
import type { Settings } from "./settings.ts"
import type { Store } from "./store.ts"

export const MODEL_ID = "jabisu-free"
export const NAME = "자비수 무료 LLM 콘솔"
const INSTALL = /^[A-Za-z0-9-]{8,64}$/
const MAX_BODY = 24 * 1024 * 1024

export interface Deps {
  readonly settings: Settings
  readonly store: Store
  readonly key: () => string
  /** The free models to try first, in order. */
  readonly chain: () => readonly string[]
  /** Free requests left on the OpenRouter account today, when known. */
  readonly freeLeft: () => number | undefined
  readonly open: () => boolean
  /** Told about every answer OpenRouter could not give, so repeated failures can start a new model check. */
  readonly failed: (status: number) => void
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly log?: (line: string) => void
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
  res.end(JSON.stringify(body))
}

const refuse = (res: ServerResponse, refusal: Refusal) =>
  send(
    res,
    refusal.status,
    { error: { type: refusal.type, code: refusal.status, message: refusal.message } },
    refusal.retryAfter ? { "retry-after": String(refusal.retryAfter) } : {},
  )

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error("too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })

const header = (req: IncomingMessage, name: string) => {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * The address a request came from: what Cloudflare's tunnel reports, else the first hop Tailscale Funnel reports, else
 * the socket's. The console listens only on 127.0.0.1, so these headers come from the tunnel, not from the caller.
 */
export const address = (req: IncomingMessage) =>
  header(req, "cf-connecting-ip")?.trim() ||
  header(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
  req.socket.remoteAddress ||
  "unknown"

export function handler(deps: Deps) {
  const now = deps.now ?? Date.now
  const http = deps.fetch ?? fetch
  const { settings, store } = deps
  const krw = (usd: number) => usd * settings.krwPerUsd

  // A status check reads the trial day; only a request starts it.
  const situation = (install: string, ip: string, time: number, start: boolean) => {
    const today = day(time)
    const first = start ? store.firstDay(install, time) : (store.firstDayOf(install) ?? today)
    return {
      trialDay: between(first, today),
      freeUsed: store.freeUsed(install, today),
      spent: {
        install: krw(store.spent.install(install, today)),
        ip: krw(store.spent.ip(ip, today)),
        day: krw(store.spent.day(today)),
        month: krw(store.spent.month(month(time))),
      },
    }
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://console")

    if (req.method === "GET" && url.pathname === "/") return send(res, 200, { name: NAME, open: deps.open() })
    if (req.method === "GET" && url.pathname === "/v1/models")
      return send(res, 200, {
        object: "list",
        data: [{ id: MODEL_ID, object: "model", owned_by: "jabisu", context_length: settings.context }],
      })

    const install = header(req, "x-jabisu-install") ?? ""
    if (!INSTALL.test(install))
      return refuse(res, { status: 400, type: "jabisu_free_app", message: `${NAME}은 자비수 앱에서만 쓸 수 있어요.` })
    const ip = address(req)

    if (req.method === "GET" && url.pathname === "/v1/status") {
      const at = situation(install, ip, now(), false)
      return send(res, 200, { open: deps.open(), level: level(at, settings.limits) })
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions")
      return send(res, 404, { error: { type: "not_found", message: "없는 주소예요." } })

    let body: Record<string, any>
    try {
      body = JSON.parse(await read(req))
      if (!body || typeof body !== "object" || !Array.isArray(body.messages)) throw new Error("messages")
    } catch {
      return refuse(res, { status: 400, type: "jabisu_free_request", message: "요청을 읽지 못했어요." })
    }

    const time = now()
    const consent = header(req, "x-jabisu-consent")
    if (consent === settings.consentVersion) store.consent(install, consent, ip, time)
    // A question is the person's own message: the engine's main requests that end with one, not the titles and summaries
    // it asks for on its own, nor the steps after a tool ran.
    const kind = header(req, "x-jabisu-kind") ?? "primary"
    const question = kind === "primary" && body.messages.at(-1)?.role === "user"
    const at = situation(install, ip, time, true)
    const chain = deps.chain()
    const decision = decide(
      {
        now: time,
        open: deps.open(),
        consent,
        consentVersion: settings.consentVersion,
        trialDay: at.trialDay,
        question,
        recentQuestions: store.questions(install, time - 3_600_000),
        freeUsed: at.freeUsed,
        freeLeft: deps.freeLeft(),
        hasFreeModels: chain.length > 0,
        spent: at.spent,
        midnight: midnight(time),
      },
      settings.limits,
    )
    if (!decision.allow) {
      deps.log?.(`refused ${install.slice(0, 8)} ${decision.type}`)
      return refuse(res, decision)
    }

    const models = [...(decision.free ? chain : []), ...(decision.paid ? [settings.paidModel] : [])]
    const upstream: Record<string, any> = { ...body, usage: { include: true } }
    delete upstream.model
    if (models.length === 1) upstream.model = models[0]
    else upstream.models = models
    if (upstream.stream) upstream.stream_options = { ...upstream.stream_options, include_usage: true }
    for (const field of ["max_tokens", "max_completion_tokens"])
      if (typeof upstream[field] === "number") upstream[field] = Math.min(upstream[field], settings.output)

    const abort = new AbortController()
    res.on("close", () => {
      if (!res.writableEnded) abort.abort()
    })
    const used: Used = { model: undefined, cost: 0, input: 0, output: 0 }
    const finish = (status: number) => {
      const model = used.model ?? models[0] ?? "-"
      const free = model.endsWith(":free")
      store.record({
        time,
        install,
        ip,
        model,
        free: status === 200 && free,
        question: status === 200 && question,
        cost: status === 200 && !free ? used.cost : 0,
        input: used.input,
        output: used.output,
        status,
      })
      deps.log?.(
        `${status} ${install.slice(0, 8)} ${kind}${question ? " 질문" : ""} ${model} ${free ? "free" : `₩${krw(used.cost).toFixed(1)}`}`,
      )
    }

    let response: Response
    try {
      response = await http(`${settings.upstream}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${deps.key()}`,
          "content-type": "application/json",
          "HTTP-Referer": "https://github.com/SeokMyungSeop/jabisu-opencode",
          "X-Title": "Jabisu",
        },
        body: JSON.stringify(upstream),
        signal: abort.signal,
      })
    } catch {
      if (abort.signal.aborted) return
      deps.failed(0)
      finish(502)
      return refuse(res, {
        status: 502,
        type: "jabisu_free_upstream",
        message: `${NAME}이 AI에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요.`,
      })
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      deps.failed(response.status)
      finish(response.status)
      if (response.status === 402 || response.status === 403)
        return refuse(res, {
          status: 503,
          type: "jabisu_free_full",
          message: `${NAME}에 준비한 양이 다 찼어요. ${OWN_KEY}`,
        })
      if (response.status === 429)
        return refuse(res, {
          status: 429,
          type: "jabisu_free_busy",
          message: "지금 무료 모델이 붐벼요. 1분쯤 뒤에 다시 해 주세요.",
          retryAfter: 60,
        })
      let detail = ""
      try {
        detail = JSON.parse(text)?.error?.message ?? ""
      } catch {}
      return refuse(res, {
        status: response.status === 400 ? 400 : 502,
        type: "jabisu_free_upstream",
        message: `AI가 요청을 처리하지 못했어요.${detail ? ` (${detail.slice(0, 200)})` : ""}`,
      })
    }

    const type = response.headers.get("content-type") ?? "application/json"
    if (!upstream.stream || !response.body) {
      const text = await response.text()
      try {
        const json = JSON.parse(text)
        take(json, used)
        finish(200)
        return send(res, 200, json)
      } catch {
        finish(502)
        return refuse(res, { status: 502, type: "jabisu_free_upstream", message: "AI의 답을 읽지 못했어요." })
      }
    }

    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" })
    const reader = response.body.pipeThrough(events(used)).getReader()
    try {
      for (let next = await reader.read(); !next.done; next = await reader.read()) res.write(next.value)
      res.end()
      finish(200)
    } catch {
      if (!res.writableEnded) res.end()
      finish(abort.signal.aborted ? 499 : 502)
    }
  }
}
