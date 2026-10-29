import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"

// 자비수's 진행 흐름: the steps of the latest request, drawn left to right above the composer. The steps are the AI's
// own to-do list when it wrote one for this request; otherwise its tool calls in order, with neighbouring calls of the
// same kind (reading files, looking things up, writing files …) merged into one step.

export type WorkflowStatus = "done" | "active" | "waiting" | "failed" | "skipped"

export type WorkflowKind =
  | "read"
  | "lookup"
  | "law"
  | "write"
  | "run"
  | "skill"
  | "ask"
  | "delegate"
  | "tool"
  | "answer"

export interface WorkflowStep {
  /** The to-do item's text; absent for a step made of tool calls, which the view names by its kind. */
  readonly title?: string
  readonly kind?: WorkflowKind
  readonly status: WorkflowStatus
  /** How many tool calls the step merges. */
  readonly count: number
}

export interface Workflow {
  /** Whether the steps come from the AI's to-do list or from its tool calls. */
  readonly source: "plan" | "tools"
  readonly steps: readonly WorkflowStep[]
  /** The request is still being worked on. */
  readonly running: boolean
  /** When the request was sent, and when its last reply finished (absent while running). */
  readonly started: number
  readonly finished?: number
}

const KINDS: Record<string, WorkflowKind> = {
  read: "read",
  list: "read",
  glob: "read",
  grep: "read",
  work_search: "read",
  source_search: "read",
  webfetch: "lookup",
  websearch: "lookup",
  law_search: "law",
  law_text: "law",
  law_verify: "law",
  write: "write",
  edit: "write",
  multiedit: "write",
  apply_patch: "write",
  patch: "write",
  shell: "run",
  bash: "run",
  skill: "skill",
  skill_turn_on: "skill",
  question: "ask",
  task: "delegate",
}

/** The kind of step a tool call belongs to. */
export const kindOf = (name: string): WorkflowKind => KINDS[name] ?? "tool"

const TODO_STATUS: Record<string, WorkflowStatus> = {
  completed: "done",
  in_progress: "active",
  pending: "waiting",
  cancelled: "skipped",
}

// The to-do tool's input, as the engine's todowrite tool declares it.
const Todos = Schema.Array(Schema.Struct({ content: Schema.String, status: Schema.String }))
const decodeTodos = Schema.decodeUnknownOption(Todos)

function readTodos(tool: SessionMessageAssistantTool) {
  if (tool.state.status === "streaming") return

  return Option.getOrUndefined(decodeTodos(tool.state.input.todos))
}

function toolStatus(tool: SessionMessageAssistantTool): WorkflowStatus {
  if (tool.state.status === "streaming" || tool.state.status === "running") return "active"

  return tool.state.status === "error" ? "failed" : "done"
}

/** The latest request's steps, or nothing when it has fewer than two (a plain answer needs no flow). */
export function projectWorkflow(messages: readonly SessionMessageInfo[], running: boolean): Workflow | undefined {
  const last = messages.findLastIndex((message) => message.type === "user")

  if (last === -1) return

  const turn = messages.slice(last + 1)
  const tools = turn.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part): part is SessionMessageAssistantTool => part.type === "tool")
      : [],
  )
  const assistants = turn.filter((message) => message.type === "assistant")

  const started = messages[last]!.time.created
  const finished = running ? undefined : assistants.at(-1)?.time.completed

  const plan = tools.findLast((tool) => tool.name === "todowrite")
  const todos = plan ? readTodos(plan) : undefined

  if (todos && todos.length >= 2)
    return {
      source: "plan",
      running,
      started,
      finished,
      steps: todos.map((todo) => ({
        title: todo.content,
        status: !running && todo.status === "in_progress" ? "waiting" : (TODO_STATUS[todo.status] ?? "waiting"),
        count: 0,
      })),
    }

  const steps: { kind: WorkflowKind; status: WorkflowStatus; count: number }[] = []

  for (const tool of tools) {
    if (tool.name === "todowrite") continue
    const kind = kindOf(tool.name)
    const status = toolStatus(tool)
    const previous = steps.at(-1)

    if (previous?.kind === kind) {
      previous.count += 1
      // A merged step is as far along as its latest call.
      previous.status = status
      continue
    }

    steps.push({ kind, status, count: 1 })
  }

  // Work of a single kind, such as reading a few files before answering, needs no flow.
  if (steps.length < 2) return

  // After the tools comes the answer: still being written, or written.
  const answering = running && steps.every((step) => step.status !== "active")

  if (answering || !running) steps.push({ kind: "answer", status: answering ? "active" : "done", count: 0 })

  return { source: "tools", running, started, finished, steps }
}
