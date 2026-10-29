import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import type { SessionContextUsageCategory } from "@opencode/client/promise"
import { createLatest, type MountedSession } from "../sdk"
import type { SessionUsage } from "./usage"

export const colors: Readonly<Record<SessionContextUsageCategory, string>> = {
  system: "var(--v2-avatar-border-purple)",
  tools: "var(--v2-avatar-border-orange)",
  mcp: "var(--v2-avatar-border-green)",
  skills: "var(--v2-avatar-border-cyan)",
  instructions: "var(--v2-avatar-border-yellow)",
  messages: "var(--v2-avatar-border-blue)",
}

export const FREE = "var(--v2-background-bg-layer-04, var(--border-weak-base))"

/** One line: a name on the left and its value on the right, with an optional color mark and share. */
export function SummaryRow(props: {
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

// The ring in pixels for each size: its size and its line's width.
const RINGS = { small: { size: 76, stroke: 11 }, large: { size: 124, stroke: 17 } } as const

/** The window as a ring: each part's share of the whole window in its color, from the top, over the free space. */
export function Donut(props: {
  parts: readonly { readonly color: string; readonly share: number }[]
  label: string
  description: string
  size?: keyof typeof RINGS
}) {
  const ring = () => {
    const { size, stroke } = RINGS[props.size ?? "small"]

    return { size, stroke, radius: (size - stroke) / 2, length: Math.PI * (size - stroke) }
  }

  const arcs = () => {
    const lengths = props.parts.map((part) => (ring().length * part.share) / 100)

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
      style={{ width: `${ring().size}px`, height: `${ring().size}px` }}
    >
      <svg viewBox={`0 0 ${ring().size} ${ring().size}`} class="size-full -rotate-90">
        <circle
          cx={ring().size / 2}
          cy={ring().size / 2}
          r={ring().radius}
          fill="none"
          stroke={FREE}
          stroke-width={ring().stroke}
        />
        <For each={arcs()}>
          {(arc) => (
            <circle
              cx={ring().size / 2}
              cy={ring().size / 2}
              r={ring().radius}
              fill="none"
              stroke={arc.color}
              stroke-width={ring().stroke}
              stroke-dasharray={`${arc.length} ${ring().length - arc.length}`}
              stroke-dashoffset={-arc.start}
            />
          )}
        </For>
      </svg>
      <span
        class="absolute inset-0 flex items-center justify-center tabular-nums text-v2-text-text-base"
        classList={{ "text-13-medium": props.size !== "large", "text-16-medium": props.size === "large" }}
      >
        {props.label}
      </span>
    </div>
  )
}

/**
 * What fills the session's context window, part by part, as the server estimates it: again after each response and
 * when an MCP server's tools come or go. Each part's width is its share of the whole window.
 */
export function createContextBreakdown(session: Accessor<MountedSession>, usage: SessionUsage) {
  const request = createMemo(
    () => {
      const current = session()
      const id = current.id

      if (!id || !current.server.connected) return
      const servers = current.server.data.location.mcp.server.list({ directory: current.directory })

      return {
        id,
        client: current.server.client,
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

  // A response can overrun the window before compaction catches up; the ring stays full.
  const filled = () => Math.min(usage.context()?.usage ?? 0, 100)

  // The last session's estimate never shows for another.
  const parts = createMemo(() => {
    const latest = estimate.latest

    if (!latest || latest.id !== session().id) return
    const sum = latest.usage.categories.reduce((total, entry) => total + entry.tokens, 0)

    if (sum === 0) return

    return latest.usage.categories
      .filter((entry) => entry.tokens > 0)
      .map((entry) => ({ ...entry, width: (filled() * entry.tokens) / sum }))
  })

  // The ring's arcs: the estimated parts, or the used share in one color until they come.
  const arcs = () =>
    parts()?.map((part) => ({ color: colors[part.category], share: part.width })) ?? [
      { color: "var(--v2-icon-icon-base, var(--icon-base))", share: filled() },
    ]

  return { filled, parts, arcs }
}
