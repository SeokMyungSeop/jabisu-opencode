/** The window's last route. A window opened at a route (`opened`) starts there until it stores a route of its own. */
export function getLastActiveUrl(windowID: string, opened?: string) {
  try {
    return acceptedLastActiveUrl(localStorage.getItem(windowLastActiveUrlKey(windowID)) ?? opened)
  } catch {
    // Storage is missing outside a window or refused access; the window still starts where it was opened.
    return acceptedLastActiveUrl(opened)
  }
}

export function setLastActiveUrl(windowID: string, value: string) {
  try {
    localStorage.setItem(windowLastActiveUrlKey(windowID), value)
  } catch {}
}

export function acceptedLastActiveUrl(value: string | null | undefined) {
  if (value === "/") return value
  const path = value?.split(/[?#]/, 1)[0]

  if (path === "/settings") return value ?? "/"

  if (path === "/new-session") return value ?? "/"

  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(path ?? "")) return value ?? "/"

  return "/"
}

function windowLastActiveUrlKey(windowID: string) {
  return `opencode.desktop.window.${windowID}.last-active-url`
}
