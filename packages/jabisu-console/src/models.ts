// Keeps the free models current without anyone choosing them: the public OpenRouter list gives the candidates (free,
// able to call tools, wide enough), each takes the same short test (a Korean question answered through a tool call), and
// the ones that pass, fastest first, become the chain in front of the paid model.
import type { Check } from "./store.ts"
import type { Settings } from "./settings.ts"

export interface Candidate {
  readonly id: string
  readonly context: number
}

export interface Listed {
  readonly id: string
  readonly context_length?: number
  readonly supported_parameters?: readonly string[]
  readonly architecture?: {
    readonly input_modalities?: readonly string[]
    readonly output_modalities?: readonly string[]
  }
  readonly pricing?: { readonly prompt?: string; readonly completion?: string }
}

/** Free models in the public list that can call tools, read and write text, and hold at least `minContext` tokens. */
export function candidates(list: readonly Listed[], settings: Pick<Settings, "minContext" | "exclude" | "prefer">) {
  const free = (model: Listed) =>
    model.id.endsWith(":free") || (Number(model.pricing?.prompt) === 0 && Number(model.pricing?.completion) === 0)
  return list
    .filter(
      (model) =>
        free(model) &&
        model.id !== "openrouter/free" &&
        (model.supported_parameters ?? []).includes("tools") &&
        (model.architecture?.input_modalities ?? ["text"]).includes("text") &&
        (model.architecture?.output_modalities ?? ["text"]).includes("text") &&
        (model.context_length ?? 0) >= settings.minContext &&
        !settings.exclude.includes(model.id),
    )
    .map((model) => ({ id: model.id, context: model.context_length ?? 0 }))
    .toSorted(
      (a, b) =>
        Number(settings.prefer.includes(b.id)) - Number(settings.prefer.includes(a.id)) || b.context - a.context,
    )
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_stock_price",
      description: "종목 코드로 현재 주가를 조회한다.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "6자리 종목 코드" } },
        required: ["symbol"],
      },
    },
  },
]

export interface Probe {
  readonly model: string
  readonly ok: boolean
  readonly ms: number
  readonly reason?: string
}

export type Post = (
  body: Record<string, unknown>,
  timeout: number,
) => Promise<{ status: number; json: any; text: string }>

/** One model's test: it must call the tool with the right code and then answer with the price it was given. */
export async function probe(model: string, post: Post): Promise<Probe> {
  const started = Date.now()
  const messages: unknown[] = [
    { role: "system", content: "너는 한국어로 답하는 투자 공부 도우미다. 주가는 반드시 도구로 확인한다." },
    { role: "user", content: "삼성전자(005930) 지금 주가를 확인해서 한 문장으로 알려 줘." },
  ]
  const fail = (reason: string) => ({ model, ok: false, ms: Date.now() - started, reason })
  const first = await post({ model, messages, tools: TOOLS, max_tokens: 2000 }, 60_000)
  if (first.status !== 200) return fail(`${first.status} ${first.json?.error?.message ?? first.text}`.slice(0, 160))
  const message = first.json?.choices?.[0]?.message
  const call = message?.tool_calls?.[0]
  if (call?.function?.name !== "get_stock_price") return fail("도구를 부르지 않음")
  if (!String(call.function.arguments ?? "").includes("005930")) return fail("종목 코드를 잘못 넘김")
  messages.push(message, {
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify({ symbol: "005930", price: 71200, currency: "KRW" }),
  })
  const second = await post({ model, messages, tools: TOOLS, max_tokens: 2000 }, 60_000)
  if (second.status !== 200) return fail(`${second.status} ${second.json?.error?.message ?? second.text}`.slice(0, 160))
  const answer = String(second.json?.choices?.[0]?.message?.content ?? "")
  if (!/71[,.]?200/.test(answer)) return fail("받은 주가로 답하지 않음")
  if (!/[가-힣]/.test(answer)) return fail("한국어로 답하지 않음")
  return { model, ok: true, ms: Date.now() - started }
}

/** Tests every candidate, a few seconds apart to stay inside the free per-minute limit, and builds the chain. */
export async function check(
  list: readonly Listed[],
  settings: Pick<Settings, "minContext" | "exclude" | "prefer" | "freeModels" | "context">,
  post: Post,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Check> {
  const log: Probe[] = []
  const found = candidates(list, settings)
  for (const [index, candidate] of found.entries()) {
    if (index > 0) await wait(3_500)
    log.push(
      await probe(candidate.id, post).catch((error) => ({
        model: candidate.id,
        ok: false,
        ms: 0,
        reason: String(error).slice(0, 160),
      })),
    )
  }
  const width = new Map(found.map((candidate) => [candidate.id, candidate.context]))
  // Preferred models first, then one that holds the whole context, then the fastest.
  const passed = log
    .filter((entry) => entry.ok)
    .toSorted(
      (a, b) =>
        Number(settings.prefer.includes(b.model)) - Number(settings.prefer.includes(a.model)) ||
        Number((width.get(b.model) ?? 0) >= settings.context) - Number((width.get(a.model) ?? 0) >= settings.context) ||
        a.ms - b.ms,
    )
  return { time: Date.now(), chain: passed.slice(0, settings.freeModels).map((entry) => entry.model), log }
}
