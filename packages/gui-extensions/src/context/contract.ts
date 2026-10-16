import type { JSX } from "solid-js"
import { Contract, type MountedSession } from "../sdk"

export interface ContextUsageProps {
  /** The session whose usage shows. */
  readonly session: MountedSession
}

/** The session's context window use, for panels that summarize a session. */
export interface ContextUsage {
  /**
   * The usage rows without a frame, so the host card supplies the heading: how full the context window is after the
   * latest response, its tokens against the model's limit, the cost when the model has one, and a button that opens the
   * Context tab. Shows a dash before the session's first response.
   */
  Summary(props: ContextUsageProps): JSX.Element
}

export const ContextUsage = Contract.define<ContextUsage, "context.usage">("context.usage")
