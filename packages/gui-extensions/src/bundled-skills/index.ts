import { Extension } from "../sdk"
import en from "./i18n/en"

/** 자비수: its bundled skills, copying them to the user's skills folder, and keeping copies after updates. */
export default Extension.define({
  id: "bundled-skills",
  i18n: { en, ko: () => import("./i18n/ko") },
})
