import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import en from "./i18n/en"

/** 자비수 집현전: folders of sources the user asks about, answered from them with citations. The engine owns them. */
export default Extension.define({
  id: "jiphyeonjeon",
  stores: {
    // The user agreed for good to send sources' beginnings to OpenRouter for suggested instructions.
    consent: Store.global(Schema.Struct({ openrouter: Schema.Boolean }), { openrouter: false }),
  },
  i18n: { en, ko: () => import("./i18n/ko") },
})
