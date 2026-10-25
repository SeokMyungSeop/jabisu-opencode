import { Extension } from "../sdk"
import { Capture } from "./contract"
import en from "./i18n/en"

/** 자비수: plain advice under common errors, and a questionnaire for error reports and suggestions. */
export default Extension.define({
  id: "support",
  provides: { capture: Capture },
  i18n: { en, ko: () => import("./i18n/ko") },
})
