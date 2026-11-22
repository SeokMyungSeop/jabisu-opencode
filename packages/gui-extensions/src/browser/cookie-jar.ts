import { createHash } from "node:crypto"
import type { Cookie, Cookies, CookiesSetDetails } from "electron"

// Every conversation's browser has a partition of its own, so its pages, proxy and file guard stay apart from the
// other conversations'. Logins are the exception the user expects to keep: signing in to a site in one conversation
// should hold in the next conversation of the same folder, and after the app restarts. So each folder has a jar, a
// persistent partition that never shows a page. A new browser starts with the jar's cookies, and every cookie it
// then gains or loses is written to the jar.

type Jar = Pick<Cookies, "get" | "set" | "remove" | "on" | "off">

const folderKey = (directory: string) => {
  const slashed = directory.replace(/\\/g, "/").replace(/\/+$/, "")

  // Windows folders are the same folder in any letter case.
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed
}

/** The partition holding the logins of the folder `directory` on `server`. */
export const jarPartition = (server: string, directory: string) =>
  `persist:opencode-browser-jar-${createHash("sha256").update(`${server}\n${folderKey(directory)}`).digest("hex").slice(0, 32)}`

const cookieURL = (cookie: Pick<Cookie, "domain" | "path" | "secure">) =>
  `${cookie.secure ? "https" : "http"}://${(cookie.domain ?? "").replace(/^\./, "")}${cookie.path ?? "/"}`

/** How to set `cookie` again in another partition; nothing for a cookie without a domain. */
export function cookieDetails(cookie: Cookie): CookiesSetDetails | undefined {
  if (!cookie.domain) return

  return {
    url: cookieURL(cookie),
    name: cookie.name,
    value: cookie.value,
    // A host-only cookie is set without a domain, or it would widen to the subdomains.
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.session || cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  }
}

/** Copies every cookie of `from` into `to`. A cookie the target refuses is skipped. */
export async function copyCookies(from: Pick<Cookies, "get">, to: Pick<Cookies, "set">) {
  const cookies = await from.get({})

  await Promise.all(
    cookies.map((cookie) => {
      const details = cookieDetails(cookie)

      return details ? to.set(details).catch(() => undefined) : undefined
    }),
  )
}

/** Writes each cookie `from` gains or loses to `to` from now on. Returns how to stop. */
export function mirrorCookies(from: Pick<Jar, "on" | "off">, to: Pick<Jar, "set" | "remove">) {
  const changed = (_event: unknown, cookie: Cookie, cause: string, removed: boolean) => {
    // An overwrite reports the old cookie as removed and then the new one as set; only the set matters.
    if (removed && cause === "overwrite") return
    const details = cookieDetails(cookie)

    if (!details) return
    void (removed ? to.remove(details.url, cookie.name) : to.set(details)).catch(() => undefined)
  }

  from.on("changed", changed)

  return () => void from.off("changed", changed)
}
