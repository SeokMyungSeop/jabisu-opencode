import { lazy, Suspense } from "solid-js"
import { SettingsPage, type Setup } from "../sdk"
import type definition from "./index"

const BringSection = lazy(() => import("./section"))

const setup: Setup<typeof definition> = (ctx) => {
  // The brought memory is a file on the desktop's own server, whose sessions read it.
  if (!ctx.desktop) return

  ctx.add(SettingsPage, {
    id: "bring",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section")
    },
    get entries() {
      return [{ id: "settings-bring", title: ctx.t("section"), keywords: "import memory chatgpt claude gemini 가져오기 기억" }]
    },
    render: () => (
      <Suspense>
        <BringSection />
      </Suspense>
    ),
  })
}

export default setup
