import { Extension } from "../sdk"
import en from "./i18n/en"

/** 자비수 업무 비서: the work folders the engine indexes for the AI to search, and the user's work profile. */
export default Extension.define({
  id: "work",
  i18n: { en, ko: () => import("./i18n/ko") },
})
