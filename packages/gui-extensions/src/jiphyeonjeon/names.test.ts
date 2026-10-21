import { describe, expect, test } from "bun:test"
import { freeName } from "./names"

describe("freeName", () => {
  test("keeps a free name and numbers a taken one before its extension", () => {
    expect(freeName("회의.m4a", new Set())).toBe("회의.m4a")
    expect(freeName("회의.m4a", new Set(["회의.m4a"]))).toBe("회의 (2).m4a")
    expect(freeName("회의.m4a", new Set(["회의.m4a", "회의 (2).m4a"]))).toBe("회의 (3).m4a")
    expect(freeName("README", new Set(["README"]))).toBe("README (2)")
    expect(freeName(".env", new Set([".env"]))).toBe(".env (2)")
  })
})
