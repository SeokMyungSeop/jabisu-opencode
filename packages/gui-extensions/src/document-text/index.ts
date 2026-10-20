import { Extension } from "../sdk"
import en from "./i18n/en"

/** Text previews of Hangul (HWP, HWPX) documents and Word, Excel and PowerPoint 97-2003 files in the file view. */
export default Extension.define({
  id: "document-text",
  i18n: { en },
})
