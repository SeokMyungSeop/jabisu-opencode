import { describe, expect, test } from "bun:test"
import { CJK_FONT_ASSET_URLS } from "./fonts-cjk"
import { loadFace, presentationFace, wordFonts } from "./fonts"

// Chinese and Japanese families the font package maps to its CJK add-on, whose faces for them the app does not ship:
// by name, by alias, and as weight variants that resolve through their base family.
const eastAsian = [
  "Microsoft YaHei",
  "DengXian",
  "等线",
  "等线 Light",
  "Microsoft YaHei Light",
  "Yu Gothic Medium",
  "MS Mincho",
]

describe("Korean", () => {
  test("draws Korean families with the shipped Korean face", () => {
    for (const family of ["Malgun Gothic", "맑은 고딕", "굴림", "Batang", "Malgun Gothic Semilight"])
      expect(presentationFace(family, false, false)).toMatchObject({ family: "Noto Sans KR", script: "cjk-kr" })
    expect(wordFonts().resolve("맑은 고딕", false, false)).toBeFunction()
    expect(wordFonts().resolveScriptFallback?.("cjk-kr", false, false)).toBeFunction()
  })

  test("ships the face the font package expects", async () => {
    const face = presentationFace("Malgun Gothic", false, false)

    expect(face.file).toBe("NotoSansKR-Regular.otf")
    expect(Bun.file(CJK_FONT_ASSET_URLS["NotoSansKR-Regular.otf"]()).size).toBe(face.byteLength)
  })
})

describe("presentationFace", () => {
  test("draws East Asian families with a face the app ships", async () => {
    const faces = eastAsian.map((family) => presentationFace(family, false, false))

    expect(faces.map((face) => face.script)).toEqual(eastAsian.map(() => undefined))

    const bytes = await Promise.all(faces.map(loadFace))

    expect(bytes.every((buffer) => buffer.byteLength > 0)).toBe(true)
  })

  test("keeps a serif East Asian family serif when only its weight variant is named", () => {
    expect(presentationFace("Yu Mincho Light", false, false).family).toBe("Liberation Serif")
    expect(presentationFace("Yu Gothic Light", false, false).family).toBe("Carlito")
  })

  test("still resolves Latin families to their metric-compatible faces", () => {
    expect(presentationFace("Calibri", true, false)).toMatchObject({ family: "Carlito", weight: 700 })
    expect(presentationFace("Calibri Light", false, false).family).toBe("Carlito")
    expect(presentationFace("Arial", false, true)).toMatchObject({ family: "Liberation Sans", style: "italic" })
  })
})

describe("wordFonts", () => {
  test("offers no metric-compatible face for an East Asian family, so Word's fallback measures it", () => {
    const fonts = wordFonts()

    expect(eastAsian.map((family) => fonts.resolve(family, false, false))).toEqual(eastAsian.map(() => undefined))
    expect(eastAsian.map((family) => fonts.resolveFamily?.(family, false, false))).toEqual(
      eastAsian.map(() => undefined),
    )
    expect(fonts.resolveScriptFallback?.("cjk-sc", false, false)).toBeUndefined()
  })

  test("loads a last-resort face for every East Asian weight variant", async () => {
    const fonts = wordFonts()

    const bytes = await Promise.all(
      eastAsian.map((family) => fonts.resolveLastResort?.(family, false, false, "word")?.()),
    )

    expect(bytes.map((buffer) => (buffer?.byteLength ?? 0) > 0)).toEqual(eastAsian.map(() => true))
  })

  test("still loads metric-compatible faces for Latin families", async () => {
    const bytes = await wordFonts().resolve("Times New Roman", false, false)?.()

    expect(bytes?.byteLength).toBeGreaterThan(0)
  })
})
