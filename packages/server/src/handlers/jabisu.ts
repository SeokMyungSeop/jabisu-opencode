import { Generate } from "@opencode/core/generate"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { Jiphyeonjeon } from "@opencode/core/plugin/jabisu/jiphyeonjeon"
import { LawApi } from "@opencode/core/plugin/jabisu/law/api"
import { LawSettings } from "@opencode/core/plugin/jabisu/law/settings"
import { JabisuSkills } from "@opencode/core/plugin/jabisu/skills"
import { WorkIndex } from "@opencode/core/plugin/jabisu/work/index"
import { WorkIndexer } from "@opencode/core/plugin/jabisu/work/indexer"
import { WorkProfile } from "@opencode/core/plugin/jabisu/work/profile"
import { WorkSettings } from "@opencode/core/plugin/jabisu/work/settings"
import { OpenRouter } from "@opencode/core/tool/openrouter"
import { Transcribe } from "@opencode/core/tool/transcribe"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Layer } from "effect"
import { HttpClient } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

/** Keeps the work index of the folders the user chose, for as long as the server runs. */
export const JabisuWorkIndexer = Layer.effectDiscard(
  Effect.gen(function* () {
    const deps = { fs: yield* FSUtil.Service, global: yield* Global.Service }

    yield* Effect.forkScoped(
      Effect.scoped(WorkIndexer.run(deps)).pipe(
        Effect.catchCause((cause) => Effect.logWarning("work indexer stopped", { cause })),
      ),
    )
  }),
)

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

    // 자비수's work folder and the chosen folders with the index's coverage of each, the folders still to suggest, and
    // the work profile.
    const work = Effect.gen(function* () {
      const settings = yield* WorkSettings.read({ fs, global })
      const db = WorkIndex.reader(global)
      const counts = new Map(
        (db
          ? (() => {
              try {
                return WorkIndex.stats(db)
              } finally {
                db.close()
              }
            })()
          : []
        ).map((row) => [row.folder, row]),
      )
      const chosen = new Set([...settings.received, ...settings.saved].map(WorkSettings.key))
      const candidates = (yield* WorkSettings.candidates({ fs, global })).filter(
        (candidate) => !chosen.has(WorkSettings.key(candidate.path)),
      )
      const coverage = (folder: string) => {
        const row = counts.get(folder)

        return {
          path: folder,
          files: row?.files ?? 0,
          documents: row?.documents ?? 0,
          ready: row?.ready ?? 0,
          pending: row?.pending ?? 0,
        }
      }
      const profile = WorkProfile.file(global)

      return {
        jabisu: coverage(WorkProfile.folder(global)),
        received: settings.received.map(coverage),
        saved: settings.saved.map(coverage),
        candidates,
        profile: { path: profile, exists: yield* fs.existsSafe(profile) },
      }
    })

    // Whether the law tools have a key; the key itself never leaves the server.
    const law = Effect.gen(function* () {
      const key = yield* LawSettings.key({ fs, global })

      return {
        configured: key !== undefined,
        ...(key === undefined ? {} : { masked: `${key.slice(0, 2)}${"*".repeat(Math.max(3, key.length - 2))}` }),
        apply: LawSettings.APPLY,
      }
    })

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
      .handle("jabisu.work.get", () => work)
      .handle(
        "jabisu.work.update",
        Effect.fn("server.jabisu.work.update")(function* (ctx) {
          for (const folder of [...ctx.payload.received, ...ctx.payload.saved])
            if (!(yield* fs.isDir(folder)))
              return yield* new InvalidRequestError({ message: `${folder} is not a folder`, kind: "jabisu_work" })
          yield* WorkSettings.write({ fs, global }, ctx.payload).pipe(
            Effect.mapError(
              () => new InvalidRequestError({ message: "the work folders could not be saved", kind: "jabisu_work" }),
            ),
          )
          return yield* work
        }),
      )
      .handle("jabisu.law.get", () => law)
      .handle(
        "jabisu.law.update",
        Effect.fn("server.jabisu.law.update")(function* (ctx) {
          const key = ctx.payload.key.trim()
          // A wrong key is caught here, where the user typed it, rather than in the middle of a chat.
          if (key)
            yield* LawApi.search(LawApi.transport(http, key), { kind: "law", query: "민법", limit: 1 }).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequestError({ message: `법제처에 이 인증키로 연결하지 못했습니다: ${error.reason}`, kind: "jabisu_law" }),
              ),
            )
          yield* LawSettings.write({ fs, global }, key).pipe(
            Effect.mapError(() => new InvalidRequestError({ message: "인증키를 저장하지 못했습니다", kind: "jabisu_law" })),
          )
          return yield* law
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
      .handle("jabisu.skills.turn", (ctx) =>
        JabisuSkills.turn({ fs, global }, ctx.payload.name, ctx.payload.on).pipe(
          Effect.andThen(JabisuSkills.list({ fs, global })),
          Effect.mapError(invalid("jabisu_skills")),
        ),
      )
  }),
)
