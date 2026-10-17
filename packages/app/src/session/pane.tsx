import { createContext, useContext } from "solid-js"

/**
 * Which pane of the window a session screen fills. The route's session is the primary pane. A split view's second
 * pane shows its own session's conversation and composer, while side panels, the dock, session commands and the
 * session extensions see stay with the primary pane.
 */
export type SessionPane = {
  /** The split view's second pane. */
  readonly secondary: boolean
  /** Closes the pane: the primary pane does nothing, the second pane ends the split. */
  readonly close: () => void
}

const primary: SessionPane = { secondary: false, close: () => {} }

const SessionPaneContext = createContext<SessionPane>(primary)

export const SessionPaneProvider = SessionPaneContext.Provider

export function useSessionPane() {
  return useContext(SessionPaneContext)
}
