import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { bindExtension, onIdle, Panel, SettingsPage, Slot, usePanel, type PanelTab, type Setup } from "../sdk"
import { ContextUsage } from "./contract"
import type definition from "./index"
import { SessionContextUsage } from "./indicator"
import { fetchRate, stale } from "./money"
import { ContextSummary } from "./summary"

const setup: Setup<typeof definition> = (ctx) => {
  const SessionContextTab = lazy(() => import("./tab"))
  // Compile the tab while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionContextTab.preload()))

  // 자비수: costs show in won, so fetch the day's exchange rate once the app idles when the stored one is old. The
  // store is read then, not during setup.
  const rates = new AbortController()
  onCleanup(() => rates.abort())
  onCleanup(
    onIdle(() => {
      const currency = ctx.stores.currency

      if (!stale(currency.value, Date.now())) return
      void fetchRate(rates.signal, Date.now()).then((fetched) => {
        if (fetched)
          currency.update((draft) => {
            draft.fetched = fetched
          })
      })
    }),
  )

  const CurrencySection = lazy(() => import("./currency-section"))
  ctx.add(SettingsPage, {
    id: "currency",
    page: "general",
    get title() {
      return ctx.t("currency.section")
    },
    get entries() {
      return [
        { id: "settings-currency-won", title: ctx.t("currency.won.title") },
        { id: "settings-currency-rate", title: ctx.t("currency.rate.title") },
      ]
    },
    render: () => (
      <Suspense>
        <CurrencySection />
      </Suspense>
    ),
  })

  // One tab object for every session, so neither strip updates nor a session switch remount its trigger; the label
  // reads the routed session from its state.
  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    draggable: false,
    closable: "compact",
    first: true,
    fallback: true,
    label: (state) => (
      <div class="flex items-center gap-2">
        <SessionContextUsage session={state.session} variant="indicator" />
        <div>{ctx.t("tab.title")}</div>
      </div>
    ),
  }

  ctx.add(Slot, {
    at: "session.header",
    order: 10,
    render: (input) => <SessionContextUsage session={input.session} placement="bottom" />,
  })

  ctx.provide(ContextUsage, { Summary: bindExtension((props) => <ContextSummary session={props.session} />) })

  ctx.add(
    Panel,
    (): Panel => ({
      id: "main",
      region: "side",
      // Stored before extensions as "context", then under the extension's earlier id `usage`.
      legacy: { context: "main", "usage:context": "main" },
      mobile: { title: ctx.t("mobile.title"), order: 40, kind: "menu", icon: "status" },
      list: (input) => (input.open.includes("main") ? [tab] : []),
      render: (props) => {
        const panel = usePanel()

        return (
          <Show
            when={panel.placement() !== "mobile"}
            fallback={
              <Suspense>
                <SessionContextTab session={props.session} />
              </Suspense>
            }
          >
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <Suspense>
                <SessionContextTab session={props.session} />
              </Suspense>
            </div>
          </Show>
        )
      },
    }),
  )
}

export default setup
