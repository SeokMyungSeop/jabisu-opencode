import { For } from "solid-js"
import type { ComposerStateTarget } from "@/composer/submission-state"
import { useLanguage } from "@/runtime/i18n/language"
import { STARTERS, starterPrompt, starterRoom, type Starter } from "./starter"

export function NewSessionStarters(props: { state: ComposerStateTarget; onFilled: () => void }) {
  const language = useLanguage()
  const room = () => starterRoom(props.state.current())

  const fill = (starter: Starter) => {
    const next = starterPrompt(language.t(`jabisu.starter.${starter}.frame`), props.state.current())

    props.state.set(next.prompt, next.cursor)
    props.onFilled()
  }

  // Hidden rather than removed while there are words, so the composer's surroundings do not jump as one types.
  return (
    <div
      data-component="new-session-starters"
      role="group"
      aria-label={language.t("jabisu.starter.label")}
      aria-hidden={!room()}
      class="flex flex-wrap items-center justify-center gap-2"
      classList={{ invisible: !room() }}
    >
      <For each={STARTERS}>
        {(starter) => (
          <button
            type="button"
            tabIndex={room() ? 0 : -1}
            class="h-8 rounded-full border border-v2-border-border-base px-3.5 text-[13px] text-v2-text-text-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"
            onClick={() => fill(starter)}
          >
            {language.t(`jabisu.starter.${starter}.label`)}
          </button>
        )}
      </For>
    </div>
  )
}
