import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { setLastActiveUrl } from "./route-storage"

/** Starts at `initialUrl`, the window's route from `getLastActiveUrl`, and stores each route the window moves to. */
export function DesktopMemoryRouter(props: BaseRouterProps & { windowID: string; initialUrl: string }) {
  const history = createMemoryHistory()

  if (props.initialUrl !== "/") history.set({ value: props.initialUrl, replace: true, scroll: false })
  onCleanup(history.listen((value) => setLastActiveUrl(props.windowID, value)))

  return <MemoryRouter {...props} history={history} />
}
