import { createMemo, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { useExtension } from "../sdk"
import { colors, createContextBreakdown, Donut, FREE, SummaryRow } from "./breakdown"
import type { ContextUsageProps } from "./contract"
import { createSessionContextFormatter } from "./format"
import type definition from "./index"
import { moneyFormat } from "./money"
import { SkillList } from "./skills"
import { createSessionUsage, type SessionUsage } from "./usage"

/**
 * How full the session's context window is: a ring of its parts beside the share used, the tokens and the cost, and the
 * estimated parts below it. The Context card shows it small, the Context tab large.
 */
export function ContextOverview(props: ContextUsageProps & { usage: SessionUsage; large?: boolean }) {
  const ctx = useExtension<typeof definition>()
  const i18n = useI18n()
  const formatter = createMemo(() => createSessionContextFormatter(i18n.locale()))

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const money = createMemo(() => moneyFormat(i18n.locale(), ctx.stores.currency.value))

  const tokens = () => {
    const context = props.usage.context()

    if (!context) return "—"
    const used = compact().format(context.total)

    return context.limit ? `${used} / ${compact().format(context.limit)}` : used
  }

  const breakdown = createContextBreakdown(() => props.session, props.usage)

  const free = () => {
    const context = props.usage.context()

    if (!context?.limit) return

    return compact().format(Math.max(context.limit - context.total, 0))
  }

  // A part's share of the whole window, to a tenth of a percent.
  const share = (width: number) => formatter().percent(Math.round(width * 10) / 10)

  const used = () => formatter().percent(props.usage.context()?.usage)

  // Skill descriptions are part of every request; the list shows which skills they are.
  const openSkills = (tokens: number) =>
    ctx.dialogs.open(() => <SkillList session={props.session} tokens={compact().format(tokens)} />)

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center" classList={{ "gap-3": !props.large, "gap-5": props.large }}>
        <Donut
          parts={breakdown.arcs()}
          label={used()}
          description={ctx.t("usage.chart", { percent: used() })}
          size={props.large ? "large" : "small"}
        />
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <span class="tabular-nums text-v2-text-text-base" classList={{ "text-14-medium": props.large }}>
            {used()} {ctx.t("usage.used")}
          </span>
          <SummaryRow name={ctx.t("usage.tokens")} value={tokens()} />
          <Show when={props.usage.showCost()}>
            <SummaryRow name={ctx.t("usage.cost")} value={money()(props.usage.spent())} />
          </Show>
        </div>
      </div>
      <Show when={breakdown.parts()}>
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
                <SummaryRow
                  color={FREE}
                  name={ctx.t("category.free")}
                  value={free()}
                  share={share(100 - breakdown.filled())}
                />
              )}
            </Show>
            <span class="text-12-regular text-v2-text-text-faint">{ctx.t("category.estimated")}</span>
          </div>
        )}
      </Show>
    </div>
  )
}

/** The rows of a session summary's Context card. */
export function ContextSummary(props: ContextUsageProps) {
  const ctx = useExtension<typeof definition>()
  const usage = createSessionUsage(() => props.session)

  return (
    <div class="flex flex-col gap-2 px-3 pt-1 pb-2 text-13-regular">
      <ContextOverview session={props.session} usage={usage} />
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
