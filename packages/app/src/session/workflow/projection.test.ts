import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { estimate, finishedRun, projectWorkflow, type Workflow, type WorkflowRun } from "./projection"

const user = (created: number) =>
  ({ id: `u${created}`, type: "user", text: "보고서 만들어 줘", time: { created } }) as SessionMessageInfo

const tool = (name: string, status: "running" | "completed" | "error", input: Record<string, unknown> = {}) =>
  ({
    type: "tool",
    id: `${name}-${Math.random()}`,
    name,
    state:
      status === "running"
        ? { status, input, metadata: {} }
        : status === "error"
          ? { status, input, error: { type: "unknown", message: "x" } }
          : { status, input, content: [{ type: "text", text: "" }] },
    time: { created: 0 },
  }) as SessionMessageAssistantTool

const assistant = (content: SessionMessageAssistantTool[], completed?: number) =>
  ({
    id: `a${Math.random()}`,
    type: "assistant",
    content,
    time: { created: 1, completed },
  }) as unknown as SessionMessageInfo

describe("진행 흐름", () => {
  test("merges neighbouring calls of one kind and ends with the answer", () => {
    const flow = projectWorkflow(
      [
        user(1),
        assistant([tool("read", "completed"), tool("grep", "completed"), tool("law_search", "completed")]),
        assistant([tool("write", "completed")], 9),
      ],
      false,
    )

    expect(flow?.source).toBe("tools")
    expect(flow?.finished).toBe(9)
    expect(flow?.steps.map((step) => [step.kind, step.status, step.count])).toEqual([
      ["read", "done", 2],
      ["law", "done", 1],
      ["write", "done", 1],
      ["answer", "done", 0],
    ])
  })

  test("shows the call running now as the active step, and the answer once the tools are done", () => {
    const running = projectWorkflow([user(1), assistant([tool("read", "completed"), tool("shell", "running")])], true)

    expect(running?.steps.map((step) => [step.kind, step.status])).toEqual([
      ["read", "done"],
      ["run", "active"],
    ])

    const answering = projectWorkflow([user(1), assistant([tool("read", "completed"), tool("write", "error")])], true)

    expect(answering?.steps.map((step) => [step.kind, step.status])).toEqual([
      ["read", "done"],
      ["write", "failed"],
      ["answer", "active"],
    ])
  })

  test("uses the AI's to-do list for the latest request when it wrote one", () => {
    const flow = projectWorkflow(
      [
        user(1),
        assistant([
          tool("todowrite", "completed", {
            todos: [
              { content: "자료 읽기", status: "completed" },
              { content: "집행률 계산", status: "in_progress" },
              { content: "보고서 작성", status: "pending" },
            ],
          }),
          tool("read", "completed"),
        ]),
      ],
      true,
    )

    expect(flow?.source).toBe("plan")
    expect(flow?.steps.map((step) => [step.title, step.status])).toEqual([
      ["자료 읽기", "done"],
      ["집행률 계산", "active"],
      ["보고서 작성", "waiting"],
    ])
  })

  test("looks only at the latest request and stays away from work of a single kind", () => {
    expect(projectWorkflow([user(1), assistant([], 2)], false)).toBeUndefined()
    expect(
      projectWorkflow([user(1), assistant([tool("read", "completed"), tool("grep", "completed")], 2)], false),
    ).toBeUndefined()
    expect(
      projectWorkflow([user(1), assistant([tool("read", "completed"), tool("write", "completed")], 2), user(3)], true),
    ).toBeUndefined()
  })
})

describe("예상 남은 시간", () => {
  const plan = (statuses: Workflow["steps"][number]["status"][]): Workflow => ({
    source: "plan",
    running: true,
    started: 0,
    steps: statuses.map((status, index) => ({ title: `단계 ${index + 1}`, status, count: 0 })),
  })
  const tools = (kinds: Workflow["steps"][number]["kind"][]): Workflow => ({
    source: "tools",
    running: true,
    started: 0,
    steps: kinds.map((kind) => ({ kind, status: "active", count: 1 })),
  })
  const runs = (law: boolean, seconds: number[]): WorkflowRun[] =>
    seconds.map((value, index) => ({ started: index, law, seconds: value }))

  test("follows the pace of the finished steps when the AI wrote a to-do list, generously", () => {
    // Two steps in 60 seconds, one at work and one waiting: about 105 seconds in all. Shown with half again and 20
    // seconds on top (177.5), so 118 seconds to go rather than 45.
    expect(estimate(plan(["done", "done", "active", "waiting"]), 60_000, [])).toEqual({
      remaining: 118,
      basis: "plan",
    })
  })

  test("goes by earlier similar requests on this PC, telling law lookups apart, generously", () => {
    const history = [...runs(true, [100, 140, 120, 400]), ...runs(false, [20, 30, 25])]

    // The middle of 100, 120, 140, 400 is 140, shown as 230; 40 seconds in, 190 to go.
    expect(estimate(tools(["read", "law"]), 40_000, history)).toEqual({ remaining: 190, basis: "history" })
    expect(estimate(tools(["read", "write"]), 10_000, history)).toEqual({ remaining: 48, basis: "history" })
    // Past even the generous estimate is reported as such, not as time left.
    expect(estimate(tools(["read", "law"]), 300_000, history)?.remaining).toBe(-70)
  })

  test("says nothing without a basis or once the request has finished", () => {
    expect(estimate(plan(["active", "waiting"]), 10_000, runs(false, [10, 20]))).toBeUndefined()
    expect(estimate({ ...tools(["read", "law"]), running: false, finished: 9_000 }, 10_000, runs(true, [1, 2, 3]))).toBe(
      undefined,
    )
  })

  test("remembers how long a finished request took and whether it looked up laws", () => {
    expect(finishedRun({ ...tools(["read", "law"]), running: false, started: 1_000, finished: 61_400 })).toEqual({
      started: 1_000,
      law: true,
      seconds: 60,
    })
    expect(finishedRun(tools(["read"]))).toBeUndefined()
  })
})
