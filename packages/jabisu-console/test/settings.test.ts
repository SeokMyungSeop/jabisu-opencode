import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { load } from "../src/settings.ts"

test("the console keeps its records under Local AppData on Windows and in a dot folder at home on Linux", () => {
  const windows = load({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "win32")
  assert.equal(windows.home, path.join("C:\\Users\\me\\AppData\\Local", "jabisu-console"))
  const linux = load({ HOME: "/home/me" }, "linux")
  assert.equal(linux.home, path.join("/home/me", ".jabisu-console"))
  assert.equal(linux.keyFile, path.join("/home/me", ".jabisu-console", "openrouter-key.txt"))
  assert.equal(load({ HOME: "/home/me", JABISU_CONSOLE_HOME: "/srv/console" }, "linux").home, "/srv/console")
})
