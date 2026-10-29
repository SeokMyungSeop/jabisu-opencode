import { expect, test } from "bun:test"
import type { SessionFailure } from "../sdk"
import { advise, deliberate, type Advice } from "./advice"

const cases: Array<[SessionFailure, Advice]> = [
  [
    { type: "provider.auth", status: 401, message: "User not found." },
    { id: "auth.openrouter", settings: "providers" },
  ],
  [
    { type: "provider.auth", status: 401, message: "Unauthorized", provider: "openrouter", model: "x" },
    { id: "auth.openrouter", settings: "providers" },
  ],
  [
    { type: "provider.auth", message: "invalid x-api-key", provider: "anthropic" },
    { id: "auth", settings: "providers" },
  ],
  [
    {
      type: "provider.no-route",
      status: 404,
      message: "No endpoints found matching your data policy (Free model training).",
    },
    { id: "privacy" },
  ],
  [
    {
      type: "provider.invalid-request",
      status: 400,
      message: "This endpoint's maximum context length is 131072 tokens.",
    },
    { id: "context" },
  ],
  [
    { type: "provider.invalid-request", status: 400, message: "No endpoints found that support image input" },
    { id: "image" },
  ],
  [{ type: "provider.invalid-request", status: 404, message: "No endpoints found for some/model." }, { id: "model" }],
  [{ type: "provider.quota", status: 402, message: "Insufficient credits" }, { id: "credits" }],
  [{ type: "provider.rate-limit", status: 429, message: "Rate limit exceeded: free-models-per-day" }, { id: "rate" }],
  [{ type: "provider.transport", message: "socket closed" }, { id: "network" }],
  [{ type: "unknown", message: "fetch failed" }, { id: "network" }],
  [{ type: "provider.timeout", message: "timed out" }, { id: "timeout" }],
  [{ type: "provider.internal", status: 502, message: "Bad gateway" }, { id: "server" }],
  [{ type: "provider.content-filter", message: "flagged" }, { id: "content" }],
  [{ type: "provider.invalid-request", status: 400, message: "Bad request" }, { id: "request" }],
  [
    {
      type: "provider.invalid-request",
      status: 403,
      message: "OpenCode 1.18.0 or newer is required to use the free tier",
    },
    { id: "opencode-free", settings: "providers" },
  ],
]

test.each(cases)("advises on %o", (failure, advice) => {
  expect(advise(failure)).toEqual(advice)
})

test("has nothing to add for failures it does not know", () => {
  expect(advise({ type: "tool.execution", message: "The command failed" })).toBeUndefined()
  expect(advise({ type: "unknown", message: "Something odd" })).toBeUndefined()
})

test("treats a rejected permission as the user's choice", () => {
  expect(deliberate({ type: "permission.rejected", message: "The user rejected" })).toBe(true)
  expect(deliberate({ type: "provider.auth", message: "User not found." })).toBe(false)
})
