import { lazy, Suspense } from "solid-js"
import { SettingsPage, type Setup } from "../sdk"
import type definition from "./index"

const LawSection = lazy(() => import("./section"))

const setup: Setup<typeof definition> = (ctx) => {
  // The key belongs to the desktop's own server, whose sessions use the law tools.
  if (!ctx.desktop) return

  ctx.add(SettingsPage, {
    id: "law",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section")
    },
    get entries() {
      return [{ id: "settings-law-key", title: ctx.t("key.title") }]
    },
    render: () => (
      <Suspense>
        <LawSection />
      </Suspense>
    ),
  })
}

export default setup
