import assert from "node:assert/strict"
import { test } from "node:test"
import { candidates, check, probe, type Post } from "../src/models.ts"

const listed = [
  { id: "a/wide:free", context_length: 1_000_000, supported_parameters: ["tools"] },
  { id: "b/narrow:free", context_length: 256_000, supported_parameters: ["tools"] },
  { id: "c/tiny:free", context_length: 65_536, supported_parameters: ["tools"] },
  { id: "d/no-tools:free", context_length: 1_000_000, supported_parameters: [] },
  {
    id: "e/paid",
    context_length: 1_000_000,
    supported_parameters: ["tools"],
    pricing: { prompt: "0.0000001", completion: "0.0000002" },
  },
  {
    id: "f/image:free",
    context_length: 1_000_000,
    supported_parameters: ["tools"],
    architecture: { output_modalities: ["image"] },
  },
  { id: "openrouter/free", context_length: 200_000, supported_parameters: ["tools"] },
]

test("candidates are free, call tools, write text and are wide enough; excluded ones never appear", () => {
  const settings = { minContext: 128_000, exclude: ["b/narrow:free"], prefer: [] }
  assert.deepEqual(
    candidates(listed, settings).map((c) => c.id),
    ["a/wide:free"],
  )
  assert.deepEqual(
    candidates(listed, { ...settings, exclude: [] }).map((c) => c.id),
    ["a/wide:free", "b/narrow:free"],
  )
})

// A fake OpenRouter: each model behaves as its name says.
const fake: Post = async (body) => {
  const model = String(body.model)
  const messages = body.messages as { role: string }[]
  if (model.startsWith("blocked"))
    return { status: 403, json: { error: { message: "only available on agentic harnesses" } }, text: "" }
  if (messages.length === 2) {
    if (model.startsWith("chatty"))
      return { status: 200, json: { choices: [{ message: { content: "모르겠어요" } }] }, text: "" }
    return {
      status: 200,
      json: {
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [{ id: "t1", function: { name: "get_stock_price", arguments: '{"symbol":"005930"}' } }],
            },
          },
        ],
      },
      text: "",
    }
  }
  if (model.startsWith("english"))
    return { status: 200, json: { choices: [{ message: { content: "It is 71,200 won." } }] }, text: "" }
  return { status: 200, json: { choices: [{ message: { content: "삼성전자는 71,200원입니다." } }] }, text: "" }
}

test("the test passes a model that calls the tool and answers in Korean with the price", async () => {
  assert.equal((await probe("good:free", fake)).ok, true)
  assert.match((await probe("blocked:free", fake)).reason ?? "", /403 only available/)
  assert.equal((await probe("chatty:free", fake)).reason, "도구를 부르지 않음")
  assert.equal((await probe("english:free", fake)).reason, "한국어로 답하지 않음")
})

test("the chain keeps passing models, one that holds the whole context first", async () => {
  const list = [
    { id: "good-narrow:free", context_length: 256_000, supported_parameters: ["tools"] },
    { id: "good-wide:free", context_length: 1_000_000, supported_parameters: ["tools"] },
    { id: "blocked:free", context_length: 1_000_000, supported_parameters: ["tools"] },
    { id: "chatty:free", context_length: 500_000, supported_parameters: ["tools"] },
  ]
  const settings = { minContext: 128_000, exclude: [], prefer: [], freeModels: 2, context: 400_000 }
  const result = await check(list, settings, fake, async () => {})
  assert.deepEqual(result.chain, ["good-wide:free", "good-narrow:free"])
  assert.equal(result.log.length, 4)
  assert.equal(result.log.filter((e) => e.ok).length, 2)
  // A preferred model goes first when it passes.
  const preferred = await check(list, { ...settings, prefer: ["good-narrow:free"] }, fake, async () => {})
  assert.deepEqual(preferred.chain, ["good-narrow:free", "good-wide:free"])
})
