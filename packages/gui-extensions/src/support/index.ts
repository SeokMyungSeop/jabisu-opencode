import { Extension, Store } from "../sdk"
import { Capture } from "./contract"
import en from "./i18n/en"
import { Tutorial } from "./tutorial-state"

/**
 * 자비수: plain advice under common errors, a questionnaire for error reports and suggestions, the in-app guide, and
 * the home screen's 따라하기 missions.
 */
export default Extension.define({
  id: "support",
  provides: { capture: Capture },
  stores: { tutorial: Store.global(Tutorial, { tried: [], hidden: false }) },
  i18n: { en, ko: () => import("./i18n/ko") },
})
