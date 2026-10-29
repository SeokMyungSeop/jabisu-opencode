import { createMemo, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { McpServer } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { showToast } from "@opencode/ui/toast"
import { useI18n } from "@opencode/ui/context/i18n"
import { Markdown } from "@opencode/session-ui/markdown"
import { useExtension, type MountedSession } from "../sdk"
import { SummaryRow } from "./breakdown"
import { fetchSessionExport, sessionExportFilename } from "./export"
import { createSessionContextFormatter } from "./format"
import type definition from "./index"
import { createSkillCatalog } from "./skill-catalog"
import { SkillList } from "./skills"
import { ContextOverview } from "./summary"
import { createSessionUsage } from "./usage"

// The tools that load a skill into the conversation; both take the skill's ID.
const SKILL_TOOLS: readonly string[] = ["skill", "skill_turn_on"]

const MCP_DOT: Record<McpServer["status"]["status"], string> = {
  connected: "var(--v2-avatar-border-green)",
  pending: "var(--v2-icon-icon-base, var(--icon-base))",
  disabled: "var(--v2-background-bg-layer-04, var(--border-weak-base))",
  failed: "var(--v2-avatar-border-orange)",
  needs_auth: "var(--v2-avatar-border-yellow)",
}

function Section(props: { title: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-2">
      <div class="flex min-h-7 items-center justify-between gap-2">
        <h3 class="text-12-medium text-v2-text-text-faint">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  )
}

export default function SessionContextTab(props: { session: MountedSession }) {
  const ctx = useExtension<typeof definition>()
  const layout = ctx.layout
  const system = ctx.system
  const i18n = useI18n()
  const usage = createSessionUsage(() => props.session)
  const skills = createSkillCatalog(() => props.session)
  const formatter = createMemo(() => createSessionContextFormatter(i18n.locale()))

  const counts = createMemo(() => {
    const all = usage.messages()
    const user = all.reduce((count, message) => count + (message.type === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, message) => count + (message.type === "assistant" ? 1 : 0), 0)

    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const system = usage
      .messages()
      .findLast((message) => message.type === "system")
      ?.text.trim()

    return system || undefined
  })

  // Skills the AI loaded in this conversation, in the order it first did.
  const used = createMemo(() => {
    const ids = new Set<string>()

    for (const message of usage.messages()) {
      if (message.type !== "assistant") continue

      for (const part of message.content) {
        if (part.type !== "tool" || !SKILL_TOOLS.includes(part.name) || part.state.status === "streaming") continue
        const id = part.state.input.id

        if (typeof id === "string") ids.add(id)
      }
    }

    return [...ids].map((id) => ({ id, title: skills.all().find((skill) => skill.name === id)?.title }))
  })

  const servers = () =>
    (props.session.server.data.location.mcp.server.list({ directory: props.session.directory }) ?? []).toSorted(
      (a, b) => a.name.localeCompare(b.name),
    )

  const number = (value: number | undefined) => formatter().number(value)

  const stats = [
    { label: "stats.session", value: () => usage.info()?.title ?? (props.session.id || "—") },
    { label: "stats.provider", value: () => usage.context()?.provider ?? "—" },
    { label: "stats.model", value: () => usage.context()?.model ?? "—" },
    { label: "stats.messages", value: () => counts().all.toLocaleString(i18n.locale()) },
    { label: "stats.userMessages", value: () => counts().user.toLocaleString(i18n.locale()) },
    { label: "stats.assistantMessages", value: () => counts().assistant.toLocaleString(i18n.locale()) },
    { label: "stats.inputTokens", value: () => number(usage.context()?.message.tokens.input) },
    { label: "stats.outputTokens", value: () => number(usage.context()?.message.tokens.output) },
    { label: "stats.reasoningTokens", value: () => number(usage.context()?.message.tokens.reasoning) },
    {
      label: "stats.cacheTokens",
      value: () => {
        const cache = usage.context()?.message.tokens.cache

        return `${number(cache?.read)} / ${number(cache?.write)}`
      },
    },
    { label: "stats.sessionCreated", value: () => formatter().time(usage.info()?.time.created) },
    { label: "stats.lastActivity", value: () => formatter().time(usage.context()?.message.time.created) },
  ] satisfies { label: string; value: () => JSX.Element }[]

  const exportSession = async () => {
    const sessionID = props.session.id

    if (!sessionID) return

    try {
      const data = await fetchSessionExport({
        sessionID,
        api: props.session.server.client,
      })

      const filename = sessionExportFilename(data.info)

      if (!(await system.save({ name: filename, content: JSON.stringify(data, null, 2) }))) return
      showToast({
        variant: "success",
        // Solid resolves JSX accessors under the toast's render owner, not this imperative call site.
        icon: () => <Icon name="circle-check" />,
        title: ctx.t("export.success.title"),
        description: ctx.t("export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: ctx.t("export.failed.title"),
        description: err instanceof Error ? err.message : ctx.t("export.failed.description"),
      })
    }
  }

  const openSkills = () => ctx.dialogs.open(() => <SkillList session={props.session} />)

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll

    if (!el) return

    const s = layout.scroll.get(props.session, "context")

    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y

    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }

    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined

      if (!next) return

      layout.scroll.set(props.session, "context", next)
    })
  }

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div
        data-slot="session-usage-content"
        class="px-4 pt-4 pb-6 flex flex-col gap-7 text-13-regular md:px-6 md:pb-10"
      >
        <ContextOverview session={props.session} usage={usage} large />

        <Section
          title={ctx.t("section.session")}
          action={
            <Button
              size="small"
              variant="ghost"
              class="gap-1.5 px-2 text-text-weak hover:text-text-base"
              onClick={exportSession}
            >
              <Icon name="download" size="small" />
              <span>{ctx.t("export.session")}</span>
            </Button>
          }
        >
          <div class="flex flex-col gap-1.5">
            <For each={stats}>{(stat) => <SummaryRow name={ctx.t(stat.label)} value={stat.value()} />}</For>
          </div>
        </Section>

        <Section
          title={ctx.t("section.skills")}
          action={
            <button
              type="button"
              class="flex items-center gap-1 text-v2-text-text-muted hover:text-v2-text-text-base"
              onClick={openSkills}
            >
              <span>{ctx.t("skills.on", { count: skills.on().length })}</span>
              <Icon name="outline-arrow-right" size="small" class="rtl:-scale-x-100" />
            </button>
          }
        >
          <div class="flex flex-col gap-1.5">
            <span class="text-v2-text-text-muted">{ctx.t("skills.used")}</span>
            <Show
              when={used().length > 0}
              fallback={<span class="text-v2-text-text-faint">{ctx.t("skills.none")}</span>}
            >
              <div class="flex flex-wrap gap-1.5">
                <For each={used()}>
                  {(skill) => (
                    <span
                      class="max-w-full truncate rounded-full border border-v2-border-border-base px-2.5 py-0.5 text-v2-text-text-base"
                      title={skill.id}
                    >
                      {skill.title ?? skill.id}
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Section>

        <Section title={ctx.t("section.mcp")}>
          <Show
            when={servers().length > 0}
            fallback={<span class="text-v2-text-text-faint">{ctx.t("mcp.empty")}</span>}
          >
            <div class="flex flex-col gap-1.5">
              <For each={servers()}>
                {(server) => (
                  <SummaryRow
                    color={MCP_DOT[server.status.status]}
                    name={server.name}
                    value={ctx.t(`mcp.status.${server.status.status}`)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Section>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <Section title={ctx.t("systemPrompt.title")}>
              <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </Section>
          )}
        </Show>
      </div>
    </ScrollView>
  )
}
