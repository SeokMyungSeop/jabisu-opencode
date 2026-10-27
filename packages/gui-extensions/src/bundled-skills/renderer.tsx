import { lazy, Suspense } from "solid-js"
import { showToast } from "@opencode/ui/toast"
import { createKeyed, SettingsPage, type ServerRef, type Setup } from "../sdk"
import type definition from "./index"
import { ChangedSkills, type Answer } from "./prompt"
import { builtin, locationOf } from "../builtin-server"

const SkillsSection = lazy(() => import("./section"))

const setup: Setup<typeof definition> = (ctx) => {
  // The bundled skills and the user's skills folder belong to the desktop's own server.
  if (!ctx.desktop) return

  ctx.add(SettingsPage, {
    id: "bundled-skills",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section")
    },
    get entries() {
      return [{ id: "settings-bundled-skills", title: ctx.t("section") }]
    },
    render: () => (
      <Suspense>
        <SkillsSection />
      </Suspense>
    ),
  })

  const ask = (names: readonly string[], backups: string) =>
    new Promise<Answer>((resolve) => {
      ctx.dialogs.open((dialog) => (
        <ChangedSkills
          names={names}
          backups={backups}
          onAnswer={(answer) => {
            resolve(answer)
            dialog.close()
          }}
        />
      ))
    })

  // Once the server is up after a start, an update that changed skills the user copied asks what to do with them.
  const check = async (server: ServerRef) => {
    const location = locationOf(server)
    const list = await server.client.jabisu.skills.list({ location })
    const changed = list.skills.filter((skill) => skill.status === "changed").map((skill) => skill.name)

    if (changed.length === 0) return

    const answer = await ask(changed, list.backups)

    if (!answer) return

    for (const name of changed)
      if (answer === "keep") await server.client.jabisu.skills.keep({ location, name })
      else await server.client.jabisu.skills.reset({ location, name })
  }

  createKeyed(
    () => builtin(ctx.servers),
    (server) =>
      void check(server).catch((error: Error) =>
        showToast({ variant: "error", title: ctx.t("failed"), description: error.message }),
      ),
  )
}

export default setup
