import { Icon } from "@opencode/ui/icon"
import { Schema } from "effect"
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { projectWorkflow, type WorkflowStep } from "./projection"

const WorkflowStateSchema = Persistence.struct({ collapsed: Schema.Boolean })

/** 자비수's 진행 흐름 above the composer: the latest request's steps from left to right. */
export function SessionWorkflow(props: {
  messages: () => readonly SessionMessageInfo[]
  running: () => boolean
  /** A permission request is waiting on the user, so the step at work is waiting on it too. */
  permission: () => boolean
}) {
  const language = useLanguage()
  const flow = createMemo(() => projectWorkflow(props.messages(), props.running()))
  const [state, setState] = persisted(Persist.global("jabisu.workflow"), WorkflowStateSchema, { collapsed: false })

  const [now, setNow] = createSignal(Date.now())

  const timer = setInterval(() => {
    if (props.running()) setNow(Date.now())
  }, 1000)

  onCleanup(() => clearInterval(timer))

  const current = createMemo(() => {
    const steps = flow()?.steps ?? []
    const active = steps.findIndex((step) => step.status === "active")

    return active === -1 ? steps.filter((step) => step.status === "done").length : active + 1
  })

  const elapsed = createMemo(() => {
    const value = flow()

    if (!value) return ""
    const seconds = Math.max(0, Math.round(((value.finished ?? now()) - value.started) / 1000))

    return seconds < 60
      ? language.t("jabisu.workflow.elapsed.seconds", { seconds })
      : language.t("jabisu.workflow.elapsed", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
  })

  const label = (step: WorkflowStep) => step.title ?? language.t(`jabisu.workflow.kind.${step.kind ?? "tool"}`)

  const status = (step: WorkflowStep) => (step.status === "active" && props.permission() ? "permission" : step.status)

  return (
    <Show when={flow()}>
      {(value) => (
        <section
          data-component="jabisu-workflow"
          aria-label={language.t("jabisu.workflow.title")}
          class="mb-2 rounded-[14px] bg-v2-background-bg-deep px-4 py-3 text-v2-text-text-base"
        >
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="text-[12px] font-[700] tracking-[0.08em] text-v2-text-text-accent">
              {language.t("jabisu.workflow.title")}
            </span>
            <span class="text-[13px] font-[600]">
              {value().running
                ? language.t("jabisu.workflow.progress", { current: current(), total: value().steps.length })
                : language.t("jabisu.workflow.done")}
            </span>
            <span class="ms-auto text-[12px] text-v2-text-text-faint [font-variant-numeric:tabular-nums]">
              {elapsed()}
            </span>
            <button
              type="button"
              class="rounded-full border border-v2-border-border-base px-2.5 py-0.5 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
              aria-expanded={!state.collapsed}
              onClick={() => setState("collapsed", !state.collapsed)}
            >
              {language.t(state.collapsed ? "jabisu.workflow.expand" : "jabisu.workflow.collapse")}
            </button>
          </div>
          <Show when={!state.collapsed}>
            <ol class="m-0 mt-3 flex list-none items-start overflow-x-auto p-0 [scrollbar-width:thin]">
              <For each={value().steps}>
                {(step, index) => (
                  <li
                    class="flex min-w-[104px] max-w-[200px] flex-1 flex-col gap-1"
                    aria-current={step.status === "active" ? "step" : undefined}
                  >
                    <div class="flex items-center">
                      <StepNode status={status(step)} number={index() + 1} />
                      <Show when={index() < value().steps.length - 1}>
                        <span
                          class="mx-2 h-0 flex-1 border-t-2"
                          classList={{
                            "border-v2-state-fg-success": step.status === "done",
                            "border-dashed border-v2-border-border-strong": step.status !== "done",
                          }}
                        />
                      </Show>
                    </div>
                    <span
                      class="line-clamp-2 pe-3 text-[13px] leading-[1.35]"
                      classList={{
                        "font-[700]": step.status === "active",
                        "text-v2-text-text-faint": step.status === "waiting" || step.status === "skipped",
                      }}
                    >
                      {label(step)}
                    </span>
                    <Show
                      when={status(step) !== "done" && status(step) !== "waiting"}
                      fallback={
                        <Show when={step.count > 1}>
                          <span class="text-[11px] text-v2-text-text-faint">
                            {language.t("jabisu.workflow.count", { count: step.count })}
                          </span>
                        </Show>
                      }
                    >
                      <span
                        class="self-start rounded-full px-2 py-px text-[11px] font-[600]"
                        classList={{
                          "bg-v2-state-bg-success text-v2-state-fg-success": status(step) === "active",
                          "bg-v2-state-bg-danger text-v2-state-fg-danger":
                            status(step) === "failed" || status(step) === "permission",
                          "text-v2-text-text-faint": status(step) === "skipped",
                        }}
                      >
                        {language.t(`jabisu.workflow.status.${status(step)}`)}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </section>
      )}
    </Show>
  )
}

function StepNode(props: { status: string; number: number }) {
  return (
    <span
      class="flex size-[26px] shrink-0 items-center justify-center rounded-full text-[12px] font-[700]"
      classList={{
        "bg-v2-state-fg-success text-v2-background-bg-base": props.status === "done",
        "border-[3px] border-v2-text-text-accent bg-v2-background-bg-base": props.status === "active",
        "border-2 border-v2-state-fg-danger bg-v2-background-bg-base text-v2-state-fg-danger":
          props.status === "failed" || props.status === "permission",
        "border-2 border-v2-border-border-strong bg-v2-background-bg-base text-v2-text-text-faint":
          props.status === "waiting" || props.status === "skipped",
      }}
      aria-hidden="true"
    >
      <Show when={props.status === "done"}>
        <Icon name="check" size="small" />
      </Show>
      <Show when={props.status === "active"}>
        <span class="size-2 rounded-full bg-v2-text-text-accent motion-safe:animate-pulse" />
      </Show>
      <Show when={props.status === "failed" || props.status === "permission"}>!</Show>
      <Show when={props.status === "waiting" || props.status === "skipped"}>{props.number}</Show>
    </span>
  )
}
