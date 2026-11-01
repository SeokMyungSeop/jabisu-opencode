export * as FreeConsole from "./free-console.js"
import type { IntegrationExternalMethod } from "@opencode/plugin/effect/integration"
import type { FSUtil } from "@opencode/util/fs-util"
import { Effect } from "effect"
import { randomUUID } from "node:crypto"

// 자비수 무료 LLM 콘솔: a provider that needs no key, served by 명상's console (packages/jabisu-console) through
// the Cloudflare tunnel of 명상's homepage. It shows once the person agrees to the notice in the connect dialog; the
// console then counts each install's use by a random number kept on this PC and chooses which free models answer.

export const ID = "jabisu-free"
export const NAME = "자비수 무료 LLM 콘솔"
export const MODEL = "jabisu-free"
export const MODEL_NAME = "자비수 무료"
export const CONTEXT = 400_000
export const OUTPUT = 32_000
/** The notice version below; the console asks people to agree again when it needs a newer one. */
export const CONSENT = "1"
const URL = "https://llm.sejong-nexus.ai.kr/v1"

// One point per line; the connect dialog keeps the line breaks.
export const NOTICE = [
  "• 무료 모델을 제공하는 회사(해외)가 대화 내용을 보관하거나 AI 학습에 쓸 수 있어요.",
  "• 개인정보, 민감한 정보, 비공개 업무 자료는 넣지 마세요. 넣어서 생기는 문제의 책임은 쓰는 사람에게 있어요.",
  "• 처음 7일은 넉넉하게, 그 뒤로는 하루에 조금씩 계속 쓸 수 있어요. 하루에 쓸 수 있는 양과 1시간에 할 수 있는 질문 수는 정해져 있어요.",
  "• 원하지 않으면 뒤로 가서 「OpenRouter」에 내 키를 연결해 쓰세요.",
  "• 자세한 안내(기록하는 것, 쓸 수 있는 양): https://sejong-nexus.ai.kr/jabisu-llm",
].join("\n")

/** Connecting is agreeing: a single choice nobody has picked yet, saved with the connection. */
export const method: IntegrationExternalMethod = {
  type: "external",
  id: "consent",
  label: "이용 안내에 동의하고 무료로 쓰기",
  form: [
    {
      key: "consent",
      type: "string",
      title: `${NAME} 이용 안내`,
      description: NOTICE,
      required: true,
      options: [{ value: CONSENT, label: "위 내용을 이해했고 동의합니다" }],
    },
  ],
}

export const baseURL = (env: NodeJS.ProcessEnv = process.env) => env.JABISU_FREE_CONSOLE_URL || URL

const INSTALL = /^[A-Za-z0-9-]{8,64}$/

/** This install's number for the console, made the first time and kept in the data folder. */
export const install = Effect.fn("FreeConsole.install")(function* (fs: FSUtil.Interface, file: string) {
  const saved = (yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined)))?.trim()
  if (saved && INSTALL.test(saved)) return saved
  const made = randomUUID()
  yield* fs
    .writeWithDirs(file, made)
    .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to save the free console install number", { cause })))
  return made
})

/** The notice version a connection agreed to, read from the answer the connect dialog saved. */
export const agreed = (metadata: Readonly<Record<string, unknown>> | undefined) =>
  typeof metadata?.consent === "string" ? metadata.consent : undefined
