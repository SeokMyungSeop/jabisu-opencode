import { Schema } from "effect"
import { Ipc } from "../sdk"

/**
 * A picture of the window for an error report. Main saves it under the user's Pictures folder and puts it on the
 * clipboard; the user decides whether to attach it, so nothing leaves the PC here.
 */
export const Capture = Ipc.define({
  id: "support.capture",
  methods: {
    /** Captures the calling window. Returns the PNG's path, or null when the window is gone. */
    window: { output: Schema.NullOr(Schema.String) },
  },
})
