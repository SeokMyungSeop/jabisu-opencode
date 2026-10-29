import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"

/**
 * Opens 자비수's 「새 작업실」: a draft in `<Documents>/자비수 작업실` whose first message makes the 작업실 folder it then
 * works in (see the new-session composer adapter).
 */
export function useNewWorkroom() {
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()

  return async (server?: ServerConnection.Key) => {
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === server) ?? global.servers.list()[0]

    if (!conn) return

    const reply = await global
      .ensureServerCtx(conn)
      .sdk.api.jabisu.workroom.root()
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: language.t("jabisu.workroom.failed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })

    if (!reply) return
    await tabs.newDraft({ server: ServerConnection.key(conn), directory: reply.root, workroom: true }, "")
  }
}
