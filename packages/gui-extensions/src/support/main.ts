import { app, clipboard, ClipboardItem } from "electron"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { MainSetup } from "../sdk/main"
import { Capture } from "./contract"
import type definition from "./index"

const setup: MainSetup<typeof definition> = (ctx) => {
  ctx.provide(Capture, {
    window: async (_input, caller) => {
      const window = ctx.windows.get(caller.window)

      if (!window) return null
      const image = await window.webContents.capturePage()
      const folder = path.join(app.getPath("pictures"), "자비수 오류 캡처")
      const file = path.join(folder, `오류-${stamp(new Date())}.png`)

      const png = image.toPNG()

      await mkdir(folder, { recursive: true })
      await writeFile(file, png)
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })])

      return file
    },
  })
}

/** A local time such as `20261025-214350`, which sorts and never repeats within a second. */
function stamp(date: Date) {
  const two = (value: number) => String(value).padStart(2, "0")

  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}

export default setup
