import { lazy, Suspense } from "solid-js"
import { SettingsPage, type Setup } from "../sdk"
import type definition from "./index"

const WorkSection = lazy(() => import("./section"))

const setup: Setup<typeof definition> = (ctx) => {
  // The work folders and the profile are on this PC, which only the desktop's own server reaches.
  if (!ctx.desktop) return

  ctx.add(SettingsPage, {
    id: "work",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section")
    },
    get entries() {
      return [
        { id: "settings-work-jabisu", title: ctx.t("jabisu.title") },
        { id: "settings-work-profile", title: ctx.t("profile.title") },
        { id: "settings-work-received", title: ctx.t("received.title") },
        { id: "settings-work-saved", title: ctx.t("saved.title") },
      ]
    },
    render: () => (
      <Suspense>
        <WorkSection />
      </Suspense>
    ),
  })
}

export default setup
