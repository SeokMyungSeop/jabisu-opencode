import { expect, test } from "bun:test"
import type { Cookie, CookiesSetDetails } from "electron"
import { cookieDetails, copyCookies, jarPartition, mirrorCookies } from "./cookie-jar"

const cookie = (input: Partial<Cookie>): Cookie => ({ name: "sid", value: "1", sameSite: "lax", ...input })

const store = () => {
  const held = new Map<string, CookiesSetDetails>()

  return {
    held,
    set: async (details: CookiesSetDetails) => void held.set(`${details.url} ${details.name}`, details),
    remove: async (url: string, name: string) => void held.delete(`${url} ${name}`),
  }
}

test("one folder has one jar, whatever the slashes or letter case of its Windows path", () => {
  expect(jarPartition("s", "C:\\Docs\\예산")).toBe(jarPartition("s", "c:/docs/예산/"))
  expect(jarPartition("s", "C:/Docs/예산")).not.toBe(jarPartition("s", "C:/Docs/회의록"))
  expect(jarPartition("s", "C:/Docs/예산")).not.toBe(jarPartition("other", "C:/Docs/예산"))
  expect(jarPartition("s", "/home/a/Work")).not.toBe(jarPartition("s", "/home/a/work"))
  expect(jarPartition("s", "C:/Docs/예산")).toStartWith("persist:")
})

test("sets a cookie again as it was: host-only stays host-only, a session cookie gets no expiry", () => {
  expect(
    cookieDetails(cookie({ domain: ".naver.com", path: "/", secure: true, httpOnly: true, expirationDate: 99 })),
  ).toEqual({
    url: "https://naver.com/",
    name: "sid",
    value: "1",
    domain: ".naver.com",
    path: "/",
    secure: true,
    httpOnly: true,
    expirationDate: 99,
    sameSite: "lax",
  })

  const hostOnly = cookieDetails(cookie({ domain: "accounts.google.com", hostOnly: true, path: "/a", session: true }))

  expect(hostOnly).toMatchObject({ url: "http://accounts.google.com/a" })
  expect(hostOnly).not.toHaveProperty("domain")
  expect(hostOnly).not.toHaveProperty("expirationDate")
  expect(cookieDetails(cookie({}))).toBeUndefined()
})

test("a new browser starts with the jar's cookies, skipping one the browser refuses", async () => {
  const to = store()
  const refused = cookie({ name: "bad", domain: "x.test", path: "/" })

  await copyCookies(
    { get: async () => [cookie({ domain: "naver.com", path: "/", secure: true }), refused] },
    {
      set: async (details) => {
        if (details.name === "bad") throw new Error("refused")
        await to.set(details)
      },
    },
  )

  expect([...to.held.keys()]).toEqual(["https://naver.com/ sid"])
})

test("writes logins and logouts to the jar until stopped", async () => {
  const listeners = new Set<(event: unknown, cookie: Cookie, cause: string, removed: boolean) => void>()
  const to = store()

  const stop = mirrorCookies(
    {
      // SAFETY: the fake keeps only the "changed" listener the mirror registers.
      on: ((_name: string, listener: never) => void listeners.add(listener)) as never,
      off: ((_name: string, listener: never) => void listeners.delete(listener)) as never,
    },
    to,
  )

  const emit = (item: Cookie, cause: string, removed: boolean) => listeners.forEach((fn) => fn({}, item, cause, removed))
  const login = cookie({ domain: "naver.com", path: "/", secure: true })

  emit(login, "explicit", false)
  await Promise.resolve()
  expect(to.held.size).toBe(1)

  emit(login, "overwrite", true)
  await Promise.resolve()
  expect(to.held.size).toBe(1)

  emit(login, "explicit", true)
  await Promise.resolve()
  expect(to.held.size).toBe(0)

  stop()
  emit(login, "explicit", false)
  await Promise.resolve()
  expect(to.held.size).toBe(0)
})
