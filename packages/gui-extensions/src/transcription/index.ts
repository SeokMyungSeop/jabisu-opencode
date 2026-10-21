import { Extension } from "../sdk"
import en from "./i18n/en"

/** 자비수: the setting that lets the read tool turn recordings into transcripts through OpenRouter. */
export default Extension.define({
  id: "transcription",
  i18n: { en, ko: () => import("./i18n/ko") },
})
