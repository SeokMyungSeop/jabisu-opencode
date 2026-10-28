export * as OpenRouter from "./openrouter.js"

import { Cause, Duration, Effect, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Integration } from "../integration.js"

// 자비수 asks OpenRouter directly for work outside a chat, such as transcripts and suggested instructions, with the
// key of the user's OpenRouter connection.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
const MODELS = "https://openrouter.ai/api/v1/models"
// Io Net serves some models without audio input; providers that keep request data are left out.
const PROVIDER = { ignore: ["io-net"], data_collection: "deny" }

const Completion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.NullOr(Schema.String) }),
      finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  usage: Schema.optional(Schema.Struct({ cost: Schema.optional(Schema.Number) })),
})

// OpenRouter's own account of a refused request.
const Refusal = Schema.fromJsonString(Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }))

// What the user can do about a refusal, by status.
const ADVICE: Record<number, string> = {
  401: "the OpenRouter key was refused; reconnect OpenRouter in Settings",
  402: "the OpenRouter account has no credit left; add credit at openrouter.ai",
  413: "the request is too large for the model's provider",
  429: "too many requests; try again in a few minutes",
}

/** Why OpenRouter gave no reply, with what the user can do about it. */
export class OpenRouterError extends Schema.TaggedError<OpenRouterError>()("OpenRouter.OpenRouterError", {
  message: Schema.String,
}) {}

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

// OpenRouter's catalogue says which models cannot answer without reasoning and which efforts they take.
const Catalogue = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      reasoning: Schema.optional(
        Schema.Struct({
          mandatory: Schema.optional(Schema.Boolean),
          supported_efforts: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
    }),
  ),
})
const EFFORTS = ["minimal", "low", "medium", "high"]

export type Reasoning = { readonly enabled: false } | { readonly effort: string }

/**
 * What to ask of a model's reasoning: none, or the least effort when OpenRouter's catalogue says it cannot be turned
 * off. Without the catalogue, reasoning is turned off, and a model that needs it says so in its refusal.
 */
export const reasoning = Effect.fn("OpenRouter.reasoning")(function* (http: HttpClient.HttpClient, model: string) {
  const catalogue = yield* HttpClientRequest.get(MODELS).pipe(
    http.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Catalogue)),
    Effect.timeout("30 seconds"),
    Effect.option,
  )
  const info = Option.getOrUndefined(catalogue)?.data.find((entry) => entry.id === model)?.reasoning
  if (!info?.mandatory) return { enabled: false } satisfies Reasoning
  return { effort: EFFORTS.find((effort) => info.supported_efforts?.includes(effort)) ?? "low" } satisfies Reasoning
})

/** One reply from a model, with reasoning turned off unless asked for, and what OpenRouter charged for it. */
export const complete = Effect.fn("OpenRouter.complete")(function* (
  http: HttpClient.HttpClient,
  input: {
    readonly key: string
    readonly model: string
    readonly content: Content
    readonly timeout: Duration.Input
    readonly reasoning?: Reasoning
  },
) {
  const body = JSON.stringify({
    model: input.model,
    provider: PROVIDER,
    reasoning: input.reasoning ?? { enabled: false },
    usage: { include: true },
    messages: [{ role: "user", content: input.content }],
  })
  // A dropped connection, a rate limit or a provider outage is often over a few seconds later.
  const client = http.pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      times: 3,
      schedule: Schedule.exponential("2 seconds").pipe(Schedule.jittered),
    }),
  )
  const completion = yield* Effect.gen(function* () {
    const response = yield* HttpClientRequest.post(ENDPOINT).pipe(
      HttpClientRequest.setHeaders({ authorization: `Bearer ${input.key}`, "x-title": "Jabisu" }),
      HttpClientRequest.bodyText(body, "application/json"),
      client.execute,
      Effect.mapError(
        (error) =>
          new OpenRouterError({
            message: `the connection to OpenRouter failed (${error.cause instanceof Error ? error.cause.message : error.message}); check the internet connection and try again`,
          }),
      ),
    )
    if (response.status >= 400) {
      const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
      const said = Option.match(Schema.decodeUnknownOption(Refusal)(text), {
        onNone: () => text.replace(/\s+/g, " ").trim().slice(0, 200),
        onSome: (refusal) => refusal.error.message,
      })
      const advice =
        ADVICE[response.status] ??
        (response.status >= 500 ? "OpenRouter or the model's provider had a problem; try again later" : undefined)
      return yield* new OpenRouterError({
        message: [`OpenRouter answered HTTP ${response.status}${said ? ` "${said}"` : ""}`, advice]
          .filter(Boolean)
          .join("; "),
      })
    }
    return yield* HttpClientResponse.schemaBodyJson(Completion)(response).pipe(
      Effect.mapError(() => new OpenRouterError({ message: "OpenRouter's reply could not be read" })),
    )
  }).pipe(
    Effect.timeout(input.timeout),
    // A request that hangs is usually answered at once when sent again.
    Effect.retry({ times: 1, while: Cause.isTimeoutError }),
    Effect.mapError((error) =>
      Cause.isTimeoutError(error)
        ? new OpenRouterError({ message: "OpenRouter did not answer, even when asked twice; try again later" })
        : error,
    ),
  )
  const choice = completion.choices[0]
  return {
    text: choice?.message.content ?? "",
    cost: completion.usage?.cost,
    // Why the model stopped when it did not finish, such as `length` or a provider's `content_filter`.
    stopped: choice?.finish_reason && choice.finish_reason !== "stop" ? choice.finish_reason : undefined,
  }
})
