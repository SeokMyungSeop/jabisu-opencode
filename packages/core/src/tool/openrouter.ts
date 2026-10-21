export * as OpenRouter from "./openrouter.js"

import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Integration } from "../integration.js"

// 자비수 asks OpenRouter directly for work outside a chat, such as transcripts and suggested instructions, with the
// key of the user's OpenRouter connection.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
// Io Net serves some models without audio input; providers that keep request data are left out.
const PROVIDER = { ignore: ["io-net"], data_collection: "deny" }

const Completion = Schema.Struct({
  choices: Schema.Array(Schema.Struct({ message: Schema.Struct({ content: Schema.NullOr(Schema.String) }) })),
  usage: Schema.optional(Schema.Struct({ cost: Schema.optional(Schema.Number) })),
})

export type Content =
  | string
  | ReadonlyArray<
      | { readonly type: "text"; readonly text: string }
      | { readonly type: "input_audio"; readonly input_audio: { readonly data: string; readonly format: string } }
    >

/** The key of the user's OpenRouter connection, else `OPENROUTER_API_KEY`; undefined when there is neither. */
export const key = Effect.fn("OpenRouter.key")(function* (integrations: Integration.Interface) {
  const connection = yield* integrations.connection.active(Integration.ID.make("openrouter"))
  const value = connection
    ? yield* integrations.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
    : undefined
  if (value?.type === "key") return value.key
  return process.env.OPENROUTER_API_KEY
})

/** One reply from a model, without reasoning, and what OpenRouter charged for it. */
export const complete = Effect.fn("OpenRouter.complete")(function* (
  http: HttpClient.HttpClient,
  input: { readonly key: string; readonly model: string; readonly content: Content; readonly timeout: Duration.Input },
) {
  const body = JSON.stringify({
    model: input.model,
    provider: PROVIDER,
    reasoning: { enabled: false },
    usage: { include: true },
    messages: [{ role: "user", content: input.content }],
  })
  const completion = yield* HttpClientRequest.post(ENDPOINT).pipe(
    HttpClientRequest.setHeaders({ authorization: `Bearer ${input.key}`, "x-title": "Jabisu" }),
    HttpClientRequest.bodyText(body, "application/json"),
    http.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Completion)),
    Effect.timeout(input.timeout),
  )
  return { text: completion.choices[0]?.message.content ?? "", cost: completion.usage?.cost }
})
