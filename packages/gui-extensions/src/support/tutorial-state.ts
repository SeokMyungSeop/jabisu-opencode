import { Schema } from "effect"

/** Which 따라하기 missions the user tried that leave no trace to check, and whether the card is hidden. */
export const Tutorial = Schema.Struct({
  tried: Schema.Array(Schema.String),
  hidden: Schema.Boolean,
})

export type Tutorial = typeof Tutorial.Type
