export * as Exaone from "./exaone.js"
import type { IntegrationKeyMethod } from "@opencode/plugin/effect/integration"

// EXAONE (LG AI연구원): each person connects the key they were issued at exaone.ai. Its terms let only the key's owner
// call the model, so it is never served through 자비수 무료 LLM 콘솔. A key lasts 30 days from the day it was issued.

export const ID = "exaone"
export const NAME = "EXAONE (LG AI연구원)"
export const MODEL = "k-exaone_v2.5"
export const MODEL_NAME = "K-EXAONE 2.5"
/** Input and output together; the endpoint answers 400 beyond it. */
export const CONTEXT = 524_288
export const OUTPUT = 32_000
export const URL = "https://api.exaone.ai/v1"
/** The variable EXAONE's own guides name. */
export const ENV = "EXAONE_API_KEY"

export const method: IntegrationKeyMethod = {
  type: "key",
  label: "exaone.ai에서 발급받은 API 키 붙여 넣기 (발급일부터 30일 동안 쓸 수 있어요)",
}

/** The sampling the model's makers recommend; reasoning always runs and comes back in `reasoning_content`. */
export const BODY = { temperature: 1, top_p: 0.95, reasoning_effort: "low" } as const
