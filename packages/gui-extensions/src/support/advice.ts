import type { SessionFailure } from "../sdk"

export type AdviceID =
  | "auth"
  | "auth.openrouter"
  | "credits"
  | "rate"
  | "network"
  | "timeout"
  | "server"
  | "content"
  | "context"
  | "image"
  | "privacy"
  | "model"
  | "unsupported"
  | "output"
  | "request"
  | "opencode-free"

/** What to tell the user about a failure, and the settings page that fixes it, if one does. */
export interface Advice {
  readonly id: AdviceID
  readonly settings?: "providers"
}

// The engine's failure type and HTTP status decide first. The message is read only for cases the engine does not
// classify: an over-long context, image input, OpenRouter's privacy filter and its "User not found." for a bad key,
// a vanished model, network failures that reach the session as unknown errors, and OpenCode's free models, which turn
// 자비수 away because it reports its own version, lower than the OpenCode version they ask for.
const PATTERNS = {
  privacy: /data policy|privacy settings/i,
  context: /context (length|window)|maximum context|too many tokens|prompt is too long|token limit|reduce the length/i,
  image:
    /(image|vision|pdf|file) inputs? (is |are )?not supported|does not support (image|vision|pdf|file)|support image input/i,
  model: /no endpoints found|model not found|not a valid model|model .* does not exist/i,
  network: /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network error/i,
  openrouterKey: /user not found/i,
  opencodeFree: /required to use the free tier/i,
}

/** Advice for a failure, or undefined when there is nothing useful to add. */
export function advise(failure: SessionFailure): Advice | undefined {
  const { type, status, message } = failure

  if (PATTERNS.opencodeFree.test(message)) return { id: "opencode-free", settings: "providers" }

  if (PATTERNS.privacy.test(message)) return { id: "privacy" }

  if (PATTERNS.context.test(message)) return { id: "context" }

  if (PATTERNS.image.test(message)) return { id: "image" }

  if (type === "provider.auth" || status === 401)
    return {
      id: failure.provider === "openrouter" || PATTERNS.openrouterKey.test(message) ? "auth.openrouter" : "auth",
      settings: "providers",
    }

  if (type === "provider.quota" || status === 402) return { id: "credits" }

  if (type === "provider.rate-limit" || status === 429) return { id: "rate" }

  if (type === "provider.transport") return { id: "network" }

  if (type === "provider.timeout") return { id: "timeout" }

  if (type === "provider.content-filter") return { id: "content" }

  if (type === "provider.no-route" || status === 404 || PATTERNS.model.test(message)) return { id: "model" }

  if (type === "provider.internal" || (status !== undefined && status >= 500)) return { id: "server" }

  if (type === "provider.unsupported-operation") return { id: "unsupported" }

  if (type === "provider.invalid-output") return { id: "output" }

  if (type === "provider.invalid-request" || status === 400) return { id: "request" }

  if (PATTERNS.network.test(message)) return { id: "network" }

  return undefined
}

/** A failure the user caused on purpose, such as rejecting a permission, needs neither advice nor a report. */
export function deliberate(failure: SessionFailure) {
  return failure.type === "permission.rejected"
}
