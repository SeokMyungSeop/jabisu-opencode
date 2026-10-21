import { lazy, Suspense } from "solid-js"
import { SettingsPage, type Setup } from "../sdk"
import type definition from "./index"

const TranscriptionSection = lazy(() => import("./section"))

const setup: Setup<typeof definition> = (ctx) => {
  // The setting belongs to the desktop's own server, which reads the recordings.
  if (!ctx.desktop) return

  ctx.add(SettingsPage, {
    id: "transcription",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section")
    },
    get entries() {
      return [
        { id: "settings-transcription-enabled", title: ctx.t("enabled.title") },
        { id: "settings-transcription-model", title: ctx.t("model.title") },
      ]
    },
    render: () => (
      <Suspense>
        <TranscriptionSection />
      </Suspense>
    ),
  })
}

export default setup
