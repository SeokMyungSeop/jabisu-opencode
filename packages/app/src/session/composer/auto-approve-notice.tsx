import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { showToast } from "@/shell/notifications/toast"

// 「권한 자동 수락」 hides the prompts it answers, so a person could not tell it was on: a test found it moving a file
// out of 다운로드 with no one asked. While it is on for this conversation's 작업실 the composer says so. A click asks
// first, since a stray click should not change how the AI works, and then turns it off everywhere.
export function AutoApproveNotice(props: { projectID: string | undefined }) {
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServerSDK()
  const settings = useSettings()

  const on = () => settings.permissions.autoApproves(projectSettingsKey(server.scope, props.projectID))

  return (
    <Show when={on()}>
      <Tooltip placement="top" gutter={4} value={language.t("jabisu.autoAccept.notice.tooltip")}>
        <Button
          type="button"
          data-action="composer-auto-accept"
          variant="ghost-muted"
          size="normal"
          class="shrink-0 gap-1 ![font-weight:440]"
          style={{ height: "28px" }}
          onClick={() => void dialog.show(() => <TurnOffDialog />)}
        >
          <Icon name="circle-check" size="small" />
          {language.t("jabisu.autoAccept.notice")}
        </Button>
      </Tooltip>
    </Show>
  )
}

function TurnOffDialog() {
  const dialog = useDialog()
  const language = useLanguage()
  const settings = useSettings()

  const turnOff = () => {
    settings.permissions.disableAutoApprove()
    showToast({
      title: language.t("toast.permissions.autoaccept.off.title"),
      description: language.t("toast.permissions.autoaccept.off.description"),
    })
    dialog.close()
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("jabisu.autoAccept.off.title")}
          description={language.t("jabisu.autoAccept.off.description")}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={turnOff}>
          {language.t("jabisu.autoAccept.off.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
