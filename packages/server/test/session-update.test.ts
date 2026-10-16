import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("updates session metadata through PATCH and archives the session", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, method: string, body?: unknown, status = method === "PATCH" ? 204 : 200) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        expect(response.status).toBe(status)
        return response.status === 204 ? undefined : response.json()
      })

    const created = Schema.decodeUnknownSync(SessionResponse)(
      yield* request("/api/session", "POST", { metadata: { source: "create", stale: true } }),
    )
    yield* request(`/api/session/${created.data.id}`, "PATCH", { metadata: { source: "patch" } })
    const updated = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${created.data.id}`, "GET"))

    expect(updated.data.metadata).toEqual({ source: "patch" })

    yield* request(`/api/session/${created.data.id}/archive`, "POST", undefined, 204)
    const archived = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${created.data.id}`, "GET"))
    expect(archived.data.time.archived).toBeNumber()
    yield* request(`/api/session/${created.data.id}/unarchive`, "POST", undefined, 204)
    const restored = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${created.data.id}`, "GET"))
    expect(restored.data.time.archived).toBeUndefined()
  }).pipe(Effect.scoped),
)
