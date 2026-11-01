import assert from "node:assert/strict"
import { test } from "node:test"
import { events, take, type Used } from "../src/answer.ts"

const run = async (parts: string[]) => {
  const used: Used = { model: undefined, cost: 0, input: 0, output: 0 }
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part))
      controller.close()
    },
  })
  const text = await new Response(source.pipeThrough(events(used))).text()
  return { used, text }
}

test("a stream passes through as written, with the cost taken out of the usage line", async () => {
  const usage = JSON.stringify({
    id: "gen-1",
    model: "nvidia/nemotron:free",
    choices: [],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      cost: 0.0042,
      cost_details: { upstream: 0.004 },
      is_byok: false,
    },
  })
  // Cut inside a line and inside the usage JSON, as a network might.
  const whole = `: OPENROUTER PROCESSING\n\ndata: {"id":"gen-1","model":"nvidia/nemotron:free","choices":[{"delta":{"content":"안녕"}}]}\n\ndata: ${usage}\n\ndata: [DONE]\n\n`
  const { used, text } = await run([whole.slice(0, 40), whole.slice(40, 190), whole.slice(190)])

  assert.equal(used.model, "nvidia/nemotron:free")
  assert.deepEqual([used.cost, used.input, used.output], [0.0042, 120, 30])
  assert.ok(text.includes('"content":"안녕"'))
  assert.ok(text.includes(": OPENROUTER PROCESSING"))
  assert.ok(text.includes("data: [DONE]"))
  assert.ok(!text.includes("cost"))
  assert.ok(!text.includes("is_byok"))
  assert.ok(text.includes('"prompt_tokens":120'))
})

test("a whole answer gives its model and usage and loses its cost", () => {
  const used: Used = { model: undefined, cost: 0, input: 0, output: 0 }
  const json: Record<string, any> = {
    model: "deepseek/deepseek-v4.1-flash",
    usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.0001 },
  }
  assert.equal(take(json, used), true)
  assert.equal(used.cost, 0.0001)
  assert.equal(json.usage.cost, undefined)
})
