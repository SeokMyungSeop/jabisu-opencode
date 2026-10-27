import { Extension } from "../sdk"
import en from "./i18n/en"

/** 자비수: the key for 법제처's law database, which the law tools use to cite laws from their official text. */
export default Extension.define({
  id: "law",
  i18n: { en, ko: () => import("./i18n/ko") },
})
