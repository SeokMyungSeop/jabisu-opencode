import { showToast } from "@opencode/ui/toast"
import { Show } from "solid-js"
import { Command, Slot, type SessionFailure, type Setup } from "../sdk"
import { deliberate } from "./advice"
import { environment, formUrl, system, type ReportKind } from "./form"
import { ErrorHelp } from "./help"
import type definition from "./index"

const GUIDE = "https://github.com/SeokMyungSeop/jabisu-opencode#readme"

// Long enough for the command palette's closing animation.
const CLOSE_MS = 300

const setup: Setup<typeof definition> = (ctx) => {
  const open = (kind: ReportKind, failure?: SessionFailure) =>
    ctx.system.openExternal(
      formUrl({
        kind,
        error: failure?.message,
        environment: environment({ version: ctx.build.version, system: system(navigator.userAgent), failure }),
      }),
    )

  // The window is captured before the browser covers it, so the picture shows what went wrong. The menu or palette
  // that ran the command closes first.
  const report = async (failure?: SessionFailure) => {
    await new Promise((resolve) => setTimeout(resolve, CLOSE_MS))
    const capture = ctx.uses.capture()
    const file = capture.status === "active" ? await capture.value.window().catch(() => null) : null

    open("report", failure)

    if (!file) return
    showToast({
      title: ctx.t("capture.saved"),
      description: ctx.t("capture.attach", { name: file.split(/[\\/]/).at(-1) ?? file }),
      persistent: true,
      actions: [
        { label: ctx.t("capture.folder"), onClick: () => void ctx.desktop?.reveal(file) },
        { label: ctx.t("capture.close"), variant: "secondary", onClick: "dismiss" },
      ],
    })
  }

  ctx.add(Slot, {
    at: "session.error",
    render: (input) => (
      <Show when={!deliberate(input.error)}>
        <ErrorHelp failure={input.error} report={() => void report(input.error)} />
      </Show>
    ),
  })

  // The desktop's Help menu names these commands.
  ctx.add(Command, () => ({
    id: "report",
    title: ctx.t("command.report"),
    group: ctx.t("command.group"),
    run: () => report(),
  }))

  ctx.add(Command, () => ({
    id: "feedback",
    title: ctx.t("command.feedback"),
    group: ctx.t("command.group"),
    run: () => open("feedback"),
  }))

  ctx.add(Command, () => ({
    id: "guide",
    title: ctx.t("command.guide"),
    group: ctx.t("command.group"),
    run: () => ctx.system.openExternal(GUIDE),
  }))
}

export default setup
