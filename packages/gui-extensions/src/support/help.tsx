import { Button } from "@opencode/ui/button"
import { createMemo, Show } from "solid-js"
import { useExtension, type SessionFailure } from "../sdk"
import { advise } from "./advice"
import type definition from "./index"

/** Advice under a failed turn's error card, a way to the settings that fix it, and the report questionnaire. */
export function ErrorHelp(props: { failure: SessionFailure; report: () => void }) {
  const ctx = useExtension<typeof definition>()
  const advice = createMemo(() => advise(props.failure))

  return (
    <div data-slot="support-error-help" class="mt-2 flex flex-col gap-2">
      <Show when={advice()}>
        {(value) => (
          <p class="text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-base">
            {ctx.t(`advice.${value().id}`)}
          </p>
        )}
      </Show>
      <div class="flex flex-wrap gap-2">
        <Show when={advice()?.settings}>
          {(page) => (
            <Button type="button" size="small" variant="neutral" onClick={() => ctx.layout.settings(page())}>
              {ctx.t("action.providers")}
            </Button>
          )}
        </Show>
        <Button
          type="button"
          size="small"
          variant="ghost"
          title={ctx.t("action.report.description")}
          onClick={props.report}
        >
          {ctx.t("action.report")}
        </Button>
      </div>
    </div>
  )
}
