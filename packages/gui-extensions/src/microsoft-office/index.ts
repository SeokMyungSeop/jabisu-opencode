import { Extension } from "../sdk"
import en from "./i18n/en"

/** Read-only previews of Word, Excel and PowerPoint files in the file view. */
export default Extension.define({
  id: "microsoft-office",
  i18n: { en, ko: () => import("./i18n/ko") },
})
