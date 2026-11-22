import { Extension } from "../sdk"
import en from "./i18n/en"

/** 자비수: brings what another AI assistant knows about the user, by a prompt the user sends it and its pasted answer. */
export default Extension.define({
  id: "bring",
  i18n: { en, ko: () => import("./i18n/ko") },
})
