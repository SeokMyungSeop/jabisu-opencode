import { describe, expect, test } from "bun:test"
import { FALLBACK_RATE, moneyFormat, stale, wonPerDollar } from "./money"

const day = 24 * 60 * 60 * 1000

const fetched = { rate: 1327.84, date: "2026-10-20", at: 0 }

describe("moneyFormat", () => {
  test("converts dollars to won at the fetched rate, keeping a decimal under 10 won", () => {
    const format = moneyFormat("ko", { code: "KRW", fetched })

    expect(format(1.4)).toBe("₩1,859")
    expect(format(0.0042)).toBe("₩5.6")
    expect(format(0)).toBe("₩0")
  })

  test("prefers the rate the user entered, and falls back before any rate is known", () => {
    expect(moneyFormat("ko", { code: "KRW", fetched, manual: 1500 })(2)).toBe("₩3,000")
    expect(moneyFormat("ko", { code: "KRW" })(1)).toBe(`₩${FALLBACK_RATE.toLocaleString("ko")}`)
    expect(wonPerDollar({ code: "KRW", fetched })).toBe(1327.84)
  })

  test("shows dollars when won is turned off", () => {
    expect(moneyFormat("en-US", { code: "USD", fetched })(1.4)).toBe("$1.40")
  })
})

describe("stale", () => {
  test("asks for the day's rate only while won shows at the fetched rate and it is old or missing", () => {
    expect(stale({ code: "KRW" }, 0)).toBe(true)
    expect(stale({ code: "KRW", fetched }, day / 4)).toBe(false)
    expect(stale({ code: "KRW", fetched }, day)).toBe(true)
    expect(stale({ code: "KRW", fetched, manual: 1500 }, day)).toBe(false)
    expect(stale({ code: "USD" }, day)).toBe(false)
  })
})
