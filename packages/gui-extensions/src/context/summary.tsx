import { createMemo, For, Show, type JSX } from "solid-js"
import type { SessionContextUsageCategory } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { createLatest, useExtension } from "../sdk"
import type { ContextUsageProps } from "./contract"
import { createSessionContextFormatter } from "./format"
import type definition from "./index"
import { moneyFormat } from "./money"
import { createSessionUsage } from "./usage"

const colors: Readonly<Record<SessionContextUsageCategory, string>> = {
  system: "var(--v2-avatar-border-purple)",
  tools: "var(--v2-avatar-border-orange)",
  mcp: "var(--v2-avatar-border-green)",
  skills: "var(--v2-avatar-border-cyan)",
  instructions: "var(--v2-avatar-border-yellow)",
  messages: "var(--v2-avatar-border-blue)",
}

function SummaryRow(props: { name: JSX.Element; value: JSX.Element; color?: string }) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <Show when={props.color}>
        {(color) => <span class="size-2 shrink-0 rounded-[2px]" style={{ background: color() }} />}
      </Show>
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ms-auto min-w-0 truncate text-end tabular-nums text-v2-text-text-base">{props.value}</span>
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

  return (
    <div class="flex flex-col gap-2 px-3 pt-1 pb-2 text-13-regular">
      <div class="flex items-center gap-3">
        <div
          role="meter"
          aria-label={ctx.t("usage.usage")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={filled()}
          class="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
          style={{ background: "var(--v2-background-bg-layer-04, var(--border-weak-base))" }}
        >
          <Show
            when={parts()}
            fallback={
              <div
                class="h-full"
                style={{ width: `${filled()}%`, background: "var(--v2-icon-icon-base, var(--icon-base))" }}
              />
            }
          >
            {(parts) => (
              <For each={parts()}>
                {(part) => (
                  <div class="h-full" style={{ width: `${part.width}%`, background: colors[part.category] }} />
                )}
              </For>
            )}
          </Show>
        </div>
        <span class="shrink-0 tabular-nums text-v2-text-text-base">{formatter().percent(usage.context()?.usage)}</span>
      </div>
      <SummaryRow name={ctx.t("usage.tokens")} value={tokens()} />
      <Show when={usage.showCost()}>
        <SummaryRow name={ctx.t("usage.cost")} value={money()(usage.spent())} />
      </Show>
      <Show when={parts()}>
        {(parts) => (
          <div class="flex flex-col gap-1.5 border-t border-v2-border-border-base pt-2">
            <For each={parts()}>
              {(part) => (
                <SummaryRow
                  color={colors[part.category]}
                  name={ctx.t(`category.${part.category}`)}
                  value={compact().format(part.tokens)}
                />
              )}
            </For>
            <Show when={free()}>{(free) => <SummaryRow name={ctx.t("category.free")} value={free()} />}</Show>
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
