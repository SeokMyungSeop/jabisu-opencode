import { Generate } from "@opencode/core/generate"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { Jiphyeonjeon } from "@opencode/core/plugin/jabisu/jiphyeonjeon"
import { JabisuSkills } from "@opencode/core/plugin/jabisu/skills"
import { OpenRouter } from "@opencode/core/tool/openrouter"
import { Transcribe } from "@opencode/core/tool/transcribe"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const JabisuHandler = HttpApiBuilder.group(Api, "server.jabisu", (handlers) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const http = yield* HttpClient.HttpClient
    // The OpenRouter connection belongs to the requested Location, after its plugins activate.
    const settings = Effect.gen(function* () {
      yield* Plugin.awaitActivation
      return { fs, global, integrations: yield* Integration.Service }
    })
    const invalid = (kind: string) => (error: { readonly reason: string }) =>
      new InvalidRequestError({ message: error.reason, kind })

    return handlers
      .handle(
        "jabisu.transcription.get",
        Effect.fn("server.jabisu.transcription.get")(function* () {
          return yield* Transcribe.status(yield* settings)
        }),
      )
      .handle(
        "jabisu.transcription.update",
        Effect.fn("server.jabisu.transcription.update")(function* (ctx) {
          return yield* Transcribe.update(yield* settings, ctx.payload).pipe(
            Effect.mapError(invalid("jabisu_transcription")),
          )
        }),
      )
      .handle(
        "jabisu.jiphyeonjeon.list",
        Effect.fn("server.jabisu.jiphyeonjeon.list")(function* () {
          const { integrations } = yield* settings
          const openrouter = (yield* OpenRouter.key(integrations)) !== undefined
          return { ...(yield* Jiphyeonjeon.list({ fs, global })), openrouter, suggestModel: Jiphyeonjeon.SUGGEST_MODEL }
        }),
      )
      .handle("jabisu.jiphyeonjeon.create", (ctx) =>
        Jiphyeonjeon.create({ fs, global }, ctx.payload).pipe(Effect.mapError(invalid("jabisu_jiphyeonjeon"))),
      )
      .handle("jabisu.jiphyeonjeon.instruct", (ctx) =>
        Jiphyeonjeon.instruct({ fs, global }, ctx.payload).pipe(Effect.mapError(invalid("jabisu_jiphyeonjeon"))),
      )
      .handle("jabisu.jiphyeonjeon.sources", (ctx) =>
        Jiphyeonjeon.sources({ fs, global }, { name: ctx.query.name }).pipe(
          Effect.mapError(invalid("jabisu_jiphyeonjeon")),
        ),
      )
      .handle(
        "jabisu.jiphyeonjeon.suggest",
        Effect.fn("server.jabisu.jiphyeonjeon.suggest")(function* (ctx) {
          // OpenRouter only when the user agreed in the app; otherwise the requested Location's default model.
          const { integrations } = yield* settings
          const generate = yield* Generate.Service
          const key = ctx.payload.openrouter ? yield* OpenRouter.key(integrations) : undefined
          if (ctx.payload.openrouter && key === undefined)
            return yield* new InvalidRequestError({
              message: "OpenRouter is not connected; connect it in Settings → Providers",
              kind: "jabisu_jiphyeonjeon",
            })
          const write = (prompt: string) =>
            key === undefined
              ? generate.text({ prompt })
              : OpenRouter.complete(http, {
                  key,
                  model: Jiphyeonjeon.SUGGEST_MODEL,
                  content: prompt,
                  timeout: "2 minutes",
                }).pipe(Effect.map((reply) => reply.text))
          const instructions = yield* Jiphyeonjeon.suggest({ fs, global }, { name: ctx.payload.name }, write).pipe(
            Effect.mapError(invalid("jabisu_jiphyeonjeon")),
          )
          return { instructions }
        }),
      )
      .handle("jabisu.skills.list", () => JabisuSkills.list({ fs, global }))
      .handle("jabisu.skills.copy", (ctx) =>
        JabisuSkills.copy({ fs, global }, ctx.payload.name).pipe(
          Effect.andThen(JabisuSkills.list({ fs, global })),
          Effect.mapError(invalid("jabisu_skills")),
        ),
      )
      .handle("jabisu.skills.keep", (ctx) =>
        JabisuSkills.keep({ fs, global }, ctx.payload.name).pipe(
          Effect.andThen(JabisuSkills.list({ fs, global })),
          Effect.mapError(invalid("jabisu_skills")),
        ),
      )
      .handle(
        "jabisu.skills.reset",
        Effect.fn("server.jabisu.skills.reset")(function* (ctx) {
          const backup = yield* JabisuSkills.reset({ fs, global }, ctx.payload.name, new Date()).pipe(
            Effect.mapError(invalid("jabisu_skills")),
          )
          return { backup, list: yield* JabisuSkills.list({ fs, global }) }
        }),
      )
  }),
)
