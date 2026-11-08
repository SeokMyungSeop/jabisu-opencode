import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { useCommand } from "@/shell/commands/command"

// 「권한 자동 수락」 hides the prompts it answers, so a person could not tell it was on: a test found it moving a file
// out of 다운로드 with no one asked. While it is on for this conversation's 작업실 the composer says so, and a click
// turns it off here, as the 「권한 자동 수락 중지」 command does.
export function AutoApproveNotice(props: { projectID: string | undefined }) {
  const command = useCommand()
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
          onClick={() => command.trigger("permissions.autoaccept")}
        >
          <Icon name="circle-check" size="small" />
          {language.t("jabisu.autoAccept.notice")}
        </Button>
      </Tooltip>
    </Show>
  )
}
