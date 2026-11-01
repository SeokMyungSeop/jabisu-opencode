import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { after, before, test } from "node:test"
import { handler } from "../src/proxy.ts"
import { defaults } from "../src/settings.ts"
import { open } from "../src/store.ts"

const settings = defaults("x")
const store = open(":memory:")
const sent: Record<string, any>[] = []
const failures: number[] = []
let reply: (body: Record<string, any>) => Response
let now = Date.parse("2026-11-02T03:00:00Z")

// A fake OpenRouter that records what it was sent and answers as each test says.
const fakeFetch = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body))
  sent.push(body)
  return reply(body)
}) as typeof fetch

const stream = (model: string, cost: number) =>
  new Response(
    [
      `data: ${JSON.stringify({ model, choices: [{ delta: { content: "안녕하세요" } }] })}\n\n`,
      `data: ${JSON.stringify({ model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, cost } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""),
    { headers: { "content-type": "text/event-stream" } },
  )

let server: Server
let base = ""
before(async () => {
  server = createServer(
    handler({
      settings,
      store,
      key: () => "sk-test",
      chain: () => ["free/one:free", "free/two:free"],
      freeLeft: () => 900,
      open: () => true,
      failed: (status) => failures.push(status),
      fetch: fakeFetch,
      now: () => now,
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
})
after(() => {
  server.close()
  store.close()
})

const ask = (
  headers: Record<string, string>,
  body: unknown = { model: "jabisu-free", stream: true, messages: [{ role: "user", content: "안녕" }] },
) =>
  fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

// Response bodies are whatever the console wrote; the tests read them loosely.
const json = (response: Response): Promise<any> => response.json()

const app = { "x-jabisu-install": "install-0001", "x-jabisu-consent": "1" }

test("requests without a 자비수 install or with no consent never reach OpenRouter", async () => {
  const bare = await ask({})
  assert.equal(bare.status, 400)
  assert.match((await json(bare)).error.message, /자비수 앱에서만/)
  const unconsented = await ask({ "x-jabisu-install": "install-0001" })
  assert.equal(unconsented.status, 403)
  // Agreeing takes the person, not a retry, so the app is told to stop and show the message.
  assert.equal(unconsented.headers.get("x-should-retry"), "false")
  assert.equal((await json(unconsented)).error.type, "jabisu_free_consent")
  assert.equal(sent.length, 0)
})

test("an answer streams back without its cost and is counted by the model that gave it", async () => {
  reply = () => stream("free/one:free", 0)
  const response = await ask(app)
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.ok(text.includes("안녕하세요"))
  assert.ok(!text.includes("cost"))

  const body = sent.at(-1)!
  assert.equal(body.model, undefined)
  assert.deepEqual(body.models, ["free/one:free", "free/two:free", settings.paidModel])
  assert.deepEqual(body.usage, { include: true })
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(store.freeUsed("install-0001", "2026-11-02"), 1)
  assert.equal(store.spent.install("install-0001", "2026-11-02"), 0)
})

test("paid answers count against the day's allowance; once it is used only free models are asked", async () => {
  // ₩280 of a ₩300 first day, then ₩28 more: over the allowance.
  reply = () => stream(settings.paidModel, 0.2)
  await (await ask({ ...app, "x-jabisu-install": "install-0002" })).text()
  await (await ask({ ...app, "x-jabisu-install": "install-0002" })).text()
  assert.ok(store.spent.install("install-0002", "2026-11-02") * settings.krwPerUsd >= 300)
  reply = () => stream("free/one:free", 0)
  await (await ask({ ...app, "x-jabisu-install": "install-0002" })).text()
  assert.deepEqual(sent.at(-1)!.models, ["free/one:free", "free/two:free"])
})

test("OpenRouter's refusals come back as plain Korean and are reported as failures", async () => {
  reply = () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 })
  const busy = await ask({ ...app, "x-jabisu-install": "install-0003" })
  assert.equal(busy.status, 429)
  // A busy model may free up in a minute, so this one may be retried.
  assert.equal(busy.headers.get("x-should-retry"), null)
  assert.equal((await json(busy)).error.type, "jabisu_free_busy")
  reply = () => new Response(JSON.stringify({ error: { message: "Key limit exceeded" } }), { status: 403 })
  const full = await ask({ ...app, "x-jabisu-install": "install-0003" })
  assert.equal(full.status, 503)
  assert.equal(full.headers.get("x-should-retry"), "false")
  assert.match((await json(full)).error.message, /내 OpenRouter 키/)
  assert.deepEqual(failures, [429, 403])
  // Failed requests are not questions, so they do not use up the hour.
  assert.equal(store.questions("install-0003", 0).length, 0)
})

test("the address Cloudflare reports is the one counted", async () => {
  reply = () => stream(settings.paidModel, 0.01)
  await (await ask({ ...app, "x-jabisu-install": "install-0005", "cf-connecting-ip": "203.0.113.7" })).text()
  assert.equal(store.spent.ip("203.0.113.7", "2026-11-02"), 0.01)
})

test("tool steps go through after the hour's questions are used; a new question waits", async () => {
  reply = () => stream("free/one:free", 0)
  const install = { ...app, "x-jabisu-install": "install-0004" }
  for (let i = 0; i < 10; i++) await (await ask(install)).text()
  const step = await ask(install, {
    stream: true,
    messages: [
      { role: "user", content: "안녕" },
      { role: "assistant", tool_calls: [{ id: "t", function: { name: "read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t", content: "ok" },
    ],
  })
  assert.equal(step.status, 200)
  await step.text()
  const waiting = await ask(install)
  assert.equal(waiting.status, 429)
  assert.equal(waiting.headers.get("x-should-retry"), "false")
  assert.equal((await json(waiting)).error.type, "jabisu_free_hourly")
  assert.ok(Number(waiting.headers.get("retry-after")) > 0)
  // A title the engine asks for on its own is not a question either.
  const title = await ask({ ...install, "x-jabisu-kind": "title" })
  assert.equal(title.status, 200)
  await title.text()
})

test("after the first seven days the install keeps a small daily share", async () => {
  now = Date.parse("2026-11-09T03:00:00Z")
  reply = () => stream(settings.paidModel, 0.04)
  const later = await ask(app)
  assert.equal(later.status, 200)
  await later.text()
  // ₩56 of the ₩50 share is used, so only the free models are asked next.
  reply = () => stream("free/one:free", 0)
  await (await ask(app)).text()
  assert.deepEqual(sent.at(-1)!.models, ["free/one:free", "free/two:free"])
})

test("the status tells the share in words and does not start a trial", async () => {
  const response = await fetch(`${base}/v1/status`, { headers: { "x-jabisu-install": "install-9999" } })
  assert.deepEqual(await response.json(), { open: true, level: "넉넉해요" })
  assert.equal(store.firstDayOf("install-9999"), undefined)
})
