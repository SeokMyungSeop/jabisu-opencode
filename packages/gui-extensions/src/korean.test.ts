import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

// 자비수 shows its extensions in Korean; a string an extension has no Korean for shows in English.
const extensions = readdirSync(import.meta.dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(import.meta.dir, entry.name, "i18n", "en.ts")))
  .map((entry) => entry.name)

describe("extension Korean", () => {
  test.each(extensions)("%s loads Korean with a string for every English one", async (name) => {
    const definition = (await import(`./${name}/index`)).default
    const english: Record<string, string> = (await import(`./${name}/i18n/en`)).default
    const korean: Record<string, string> = (await import(`./${name}/i18n/ko`)).default

    expect(definition.i18n.ko).toBeFunction()
    expect(Object.keys(english).filter((key) => !(key in korean))).toEqual([])
  })
})
