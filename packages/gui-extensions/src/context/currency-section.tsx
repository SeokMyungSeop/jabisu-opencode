import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { useI18n } from "@opencode/ui/context/i18n"
import { useExtension } from "../sdk"
import type definition from "./index"
import { FALLBACK_RATE } from "./money"

/** Whether usage costs show in won, and the exchange rate they convert at. */
export default function CurrencySection() {
  const ctx = useExtension<typeof definition>()
  const i18n = useI18n()
  const currency = ctx.stores.currency
  const number = createMemo(() => new Intl.NumberFormat(i18n.locale(), { maximumFractionDigits: 2 }))
  // What the field shows while the user types; a value that is not a positive number is not stored.
  const [typed, setTyped] = createSignal(currency.value.manual === undefined ? "" : String(currency.value.manual))

  const description = () => {
    const fetched = currency.value.fetched

    if (currency.value.manual !== undefined) return ctx.t("currency.rate.manual")

    if (!fetched) return ctx.t("currency.rate.fallback", { rate: number().format(FALLBACK_RATE) })

    return ctx.t("currency.rate.auto", { rate: number().format(fetched.rate), date: fetched.date })
  }

  const change = (value: string) => {
    setTyped(value)
    const rate = Number(value.replaceAll(",", "").trim())

    currency.update((draft) => {
      if (value.trim() === "") delete draft.manual
      else if (Number.isFinite(rate) && rate > 0) draft.manual = rate
    })
  }

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("currency.section")}</h3>

      <div data-component="settings-list">
        <Row title={ctx.t("currency.won.title")} description={ctx.t("currency.won.description")}>
          <div data-action="settings-currency-won">
            <Switch
              checked={currency.value.code === "KRW"}
              onChange={(checked) =>
                currency.update((draft) => {
                  draft.code = checked ? "KRW" : "USD"
                })
              }
            />
          </div>
        </Row>

        <Show when={currency.value.code === "KRW"}>
          <Row title={ctx.t("currency.rate.title")} description={description()}>
            <div data-action="settings-currency-rate" class="w-32">
              <TextField
                label={ctx.t("currency.rate.title")}
                hideLabel
                inputmode="decimal"
                placeholder={number().format(currency.value.fetched?.rate ?? FALLBACK_RATE)}
                value={typed()}
                onChange={change}
              />
            </div>
          </Row>
        </Show>
      </div>
    </div>
  )
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
