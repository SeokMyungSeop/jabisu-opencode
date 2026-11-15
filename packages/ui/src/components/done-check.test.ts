import { beforeEach, describe, expect, test } from "bun:test"
import { doneMoment, resetDoneMoment } from "./done-check"

const visible = () => true

describe("the done moment", () => {
  beforeEach(resetDoneMoment)

  test("greets one completion and treats others in the same second as part of it", () => {
    expect(doneMoment(10_000, visible)).toBe(true)
    expect(doneMoment(10_200, visible)).toBe(false)
    expect(doneMoment(10_900, visible)).toBe(false)
    expect(doneMoment(11_100, visible)).toBe(true)
  })

  test("skips a window nobody is looking at, without using up the turn", () => {
    expect(doneMoment(10_000, () => false)).toBe(false)
    expect(doneMoment(10_100, visible)).toBe(true)
  })
})
