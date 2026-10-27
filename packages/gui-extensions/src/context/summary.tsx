import { createMemo, For, Show, type JSX } from "solid-js"
import type { SessionContextUsageCategory } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { createLatest, useExtension } from "../sdk"
import type { ContextUsageProps } from "./contract"
import { createSessionContextFormatter } from "./format"
import type definition from "./index"
import { moneyFormat } from "./money"
import { SkillList } from "./skills"
import { createSessionUsage } from "./usage"

const colors: Readonly<Record<SessionContextUsageCategory, string>> = {
  system: "var(--v2-avatar-border-purple)",
  tools: "var(--v2-avatar-border-orange)",
  mcp: "var(--v2-avatar-border-green)",
  skills: "var(--v2-avatar-border-cyan)",
  instructions: "var(--v2-avatar-border-yellow)",
  messages: "var(--v2-avatar-border-blue)",
}

const FREE = "var(--v2-background-bg-layer-04, var(--border-weak-base))"

function SummaryRow(props: {
  name: JSX.Element
  value: JSX.Element
  color?: string
  share?: string
  onClick?: () => void
}) {
  const content = () => (
    <>
      <Show when={props.color}>
        {(color) => <span class="size-2 shrink-0 rounded-[2px]" style={{ background: color() }} />}
      </Show>
      <span class="shrink-0 text-v2-text-text-muted" classList={{ "underline underline-offset-2": !!props.onClick }}>
        {props.name}
      </span>
      <span class="ms-auto min-w-0 truncate text-end tabular-nums text-v2-text-text-base">{props.value}</span>
      <Show when={props.share}>
        {(share) => <span class="w-12 shrink-0 text-end tabular-nums text-v2-text-text-muted">{share()}</span>}
      </Show>
    </>
  )

  return (
    <Show when={props.onClick} fallback={<div class="flex min-w-0 items-center gap-2">{content()}</div>}>
      {(onClick) => (
        <button
          type="button"
          class="-mx-1 flex min-w-0 items-center gap-2 rounded-[4px] px-1 text-start hover:bg-v2-overlay-simple-overlay-hover"
          onClick={() => onClick()()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

// The ring in pixels: its size, its line's width, and the radius and length of the line's middle.
const RING = { size: 76, stroke: 11, radius: (76 - 11) / 2, length: Math.PI * (76 - 11) }

/** The window as a ring: each part's share of the whole window in its color, from the top, over the free space. */
function Donut(props: {
  parts: readonly { readonly color: string; readonly share: number }[]
  label: string
  description: string
}) {
  const arcs = () => {
    const lengths = props.parts.map((part) => (RING.length * part.share) / 100)

    return props.parts.map((part, index) => ({
      color: part.color,
      length: lengths[index] ?? 0,
      start: lengths.slice(0, index).reduce((total, length) => total + length, 0),
    }))
  }

  return (
    <div
      role="img"
      aria-label={props.description}
      class="relative shrink-0"
      style={{ width: `${RING.size}px`, height: `${RING.size}px` }}
    >
      <svg viewBox={`0 0 ${RING.size} ${RING.size}`} class="size-full -rotate-90">
        <circle
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={RING.radius}
          fill="none"
          stroke={FREE}
          stroke-width={RING.stroke}
        />
        <For each={arcs()}>
          {(arc) => (
            <circle
              cx={RING.size / 2}
              cy={RING.size / 2}
              r={RING.radius}
              fill="none"
              stroke={arc.color}
              stroke-width={RING.stroke}
              stroke-dasharray={`${arc.length} ${RING.length - arc.length}`}
              stroke-dashoffset={-arc.start}
            />
          )}
        </For>
      </svg>
      <span class="absolute inset-0 flex items-center justify-center text-13-medium tabular-nums text-v2-text-text-base">
        {props.label}
      </span>
    </div>
  )
}

/** The rows of a session summary's Context card. */
export function ContextSummary(props: ContextUsageProps) {
  const ctx = useExtension<typeof definition>()
  const i18n = useI18n()
  const usage = createSessionUsage(() => props.session)
  const formatter = createMemo(() => createSessionContextFormatter(i18n.locale()))

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const money = createMemo(() => moneyFormat(i18n.locale(), ctx.stores.currency.value))

  const tokens = () => {
    const context = usage.context()

    if (!context) return "—"
    const used = compact().format(context.total)

    return context.limit ? `${used} / ${compact().format(context.limit)}` : used
  }

  // A response can overrun the window before compaction catches up; the bar stays full.
  const filled = () => Math.min(usage.context()?.usage ?? 0, 100)

  // Estimated again after each response and when an MCP server's tools come or go, while the card shows.
  const request = createMemo(
    () => {
      const id = props.session.id

      if (!id || !props.session.server.connected) return
      const servers = props.session.server.data.location.mcp.server.list({ directory: props.session.directory })

      return {
        id,
        client: props.session.server.client,
        total: usage.context()?.total,
        mcp: servers?.map((server) => `${server.name}:${server.status.status}`).join("\n"),
      }
    },
    undefined,
    {
      equals: (a, b) => a?.id === b?.id && a?.client === b?.client && a?.total === b?.total && a?.mcp === b?.mcp,
    },
  )

  const estimate = createLatest(request, async (value, signal) => ({
    id: value.id,
    usage: await value.client.session.contextUsage({ sessionID: value.id }, { signal }),
  }))

  // Each part's share of the used window; the last session's estimate never shows for another.
  const parts = createMemo(() => {
    const latest = estimate.latest

    if (!latest || latest.id !== props.session.id) return
    const sum = latest.usage.categories.reduce((total, entry) => total + entry.tokens, 0)

    if (sum === 0) return

    return latest.usage.categories
      .filter((entry) => entry.tokens > 0)
      .map((entry) => ({ ...entry, width: (filled() * entry.tokens) / sum }))
  })

  const free = () => {
    const context = usage.context()

    if (!context?.limit) return

    return compact().format(Math.max(context.limit - context.total, 0))
  }

  // A part's share of the whole window, to a tenth of a percent.
  const share = (width: number) => formatter().percent(Math.round(width * 10) / 10)

  const used = () => formatter().percent(usage.context()?.usage)

  // Skill descriptions are part of every request; the list shows which skills they are.
  const openSkills = (tokens: number) =>
    ctx.dialogs.open(() => <SkillList session={props.session} tokens={compact().format(tokens)} />)

  return (
    <div class="flex flex-col gap-2 px-3 pt-1 pb-2 text-13-regular">
      <div class="flex items-center gap-3">
        <Donut
          parts={
            parts()?.map((part) => ({ color: colors[part.category], share: part.width })) ?? [
              { color: "var(--v2-icon-icon-base, var(--icon-base))", share: filled() },
            ]
          }
          label={used()}
          description={ctx.t("usage.chart", { percent: used() })}
        />
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <span class="tabular-nums text-v2-text-text-base">
            {used()} {ctx.t("usage.used")}
          </span>
          <SummaryRow name={ctx.t("usage.tokens")} value={tokens()} />
          <Show when={usage.showCost()}>
            <SummaryRow name={ctx.t("usage.cost")} value={money()(usage.spent())} />
          </Show>
        </div>
      </div>
      <Show when={parts()}>
        {(parts) => (
          <div class="flex flex-col gap-1.5 border-t border-v2-border-border-base pt-2">
            <For each={parts()}>
              {(part) => (
                <SummaryRow
                  color={colors[part.category]}
                  name={ctx.t(`category.${part.category}`)}
                  value={compact().format(part.tokens)}
                  share={share(part.width)}
                  onClick={part.category === "skills" ? () => openSkills(part.tokens) : undefined}
                />
              )}
            </For>
            <Show when={free()}>
              {(free) => (
                <SummaryRow color={FREE} name={ctx.t("category.free")} value={free()} share={share(100 - filled())} />
              )}
            </Show>
            <span class="text-12-regular text-v2-text-text-faint">{ctx.t("category.estimated")}</span>
          </div>
        )}
      </Show>
      <Show when={props.session.id}>
        <button
          type="button"
          class="flex items-center gap-1 self-start text-v2-text-text-muted hover:text-v2-text-text-base"
          onClick={() => ctx.layout.open(`${ctx.id}:main`, props.session)}
        >
          <span>{ctx.t("usage.view")}</span>
          <Icon name="outline-arrow-right" size="small" class="rtl:-scale-x-100" />
        </button>
      </Show>
    </div>
  )
}
