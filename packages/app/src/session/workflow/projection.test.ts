import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { projectWorkflow } from "./projection"

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
