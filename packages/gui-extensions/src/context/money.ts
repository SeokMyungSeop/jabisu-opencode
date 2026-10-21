import { Option, Schema } from "effect"

/** How usage costs show: in won at an exchange rate, or in the dollars providers bill in. */
export const Currency = Schema.Struct({
  code: Schema.Literals(["KRW", "USD"]),
  /** Won per dollar the user set; the fetched rate applies while it is unset. */
  manual: Schema.optional(Schema.Number),
  /** The last fetched rate: won per dollar, the rate's own date, and when it was fetched. */
  fetched: Schema.optional(Schema.Struct({ rate: Schema.Number, date: Schema.String, at: Schema.Number })),
})

export type Currency = typeof Currency.Type

/** Won per dollar before any rate has been fetched or set. */
export const FALLBACK_RATE = 1400

// ECB reference rates, published each working day; Frankfurter serves them without a key and allows any origin.
const SOURCE = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW"

const REFRESH_MS = 12 * 60 * 60 * 1000

const RateResponse = Schema.Struct({ date: Schema.String, rates: Schema.Struct({ KRW: Schema.Number }) })

export function wonPerDollar(currency: Currency) {
  return currency.manual ?? currency.fetched?.rate ?? FALLBACK_RATE
}

/** Formats a cost reported in dollars in the chosen currency. */
export function moneyFormat(locale: string, currency: Currency) {
  if (currency.code === "USD") {
    const dollars = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" })

    return (usd: number) => dollars.format(usd)
  }

  const rate = wonPerDollar(currency)
  const whole = new Intl.NumberFormat(locale, { style: "currency", currency: "KRW", maximumFractionDigits: 0 })

  // A single request often costs a few won, so amounts under 10 won keep one decimal.
  const fine = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "KRW",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })

  return (usd: number) => {
    const won = usd * rate

    return won !== 0 && Math.abs(won) < 10 ? fine.format(won) : whole.format(won)
  }
}

/** Whether to fetch the day's rate: costs show in won at the fetched rate, and the last fetch is old or missing. */
export function stale(currency: Currency, now: number) {
  if (currency.code !== "KRW" || currency.manual !== undefined) return false

  return currency.fetched === undefined || now - currency.fetched.at > REFRESH_MS
}

/** The day's won-per-dollar rate, or undefined when it cannot be read; the stored rate then stays. */
export async function fetchRate(signal: AbortSignal, now: number) {
  const response = await fetch(SOURCE, { signal }).catch(() => undefined)

  if (!response?.ok) return
  const body = Schema.decodeUnknownOption(RateResponse)(await response.json().catch(() => undefined))

  return Option.match(body, {
    onNone: () => undefined,
    onSome: (value) => ({ rate: value.rates.KRW, date: value.date, at: now }),
  })
}
