import { describe, expect } from "bun:test"
import { createHash } from "crypto"
import path from "path"
import { deflateRawSync } from "zlib"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Sketchy } from "@opencode/core/plugin/jabisu/sketchy"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node])))

// A zip archive as a packer writes it: local headers, then the central directory the reader goes by.
function zip(entries: readonly { name: string; text: string; store?: boolean }[]) {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const raw = Buffer.from(entry.text, "utf8")
    const body = entry.store ? raw : deflateRawSync(raw)
    const local = Buffer.alloc(30)

    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(entry.store ? 0 : 8, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    const header = Buffer.alloc(46)

    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(entry.store ? 0 : 8, 10)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    central.push(header, name)
    offset += 30 + name.length + body.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)

  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

const serving = (body: Uint8Array | undefined, calls: string[] = []) =>
  HttpClient.make((request, url) => {
    calls.push(url.toString())

    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        body ? new Response(body, { status: 200 }) : new Response("not found", { status: 404 }),
      ),
    )
  })

const ARCHIVE = zip([
  { name: "./dist/index.js", text: "console.log('그림')" },
  { name: "./build/", text: "", store: true },
  { name: "./build/parts.json", text: "{}", store: true },
])

describe("Sketchy", () => {
  it.effect("reads packed and stored files and skips folders", () =>
    Effect.sync(() => {
      expect(
        Sketchy.unzip(ARCHIVE).map((file) => [file.name, Buffer.from(file.content).toString("utf8")]),
      ).toEqual([
        ["dist/index.js", "console.log('그림')"],
        ["build/parts.json", "{}"],
      ])
    }),
  )

  it.effect("refuses an entry that would be written outside its folder", () =>
    Effect.sync(() => {
      for (const name of ["../evil.js", "dist/../../evil.js", "/evil.js", "C:/evil.js", "dist\\..\\evil.js"])
        expect(() => Sketchy.unzip(zip([{ name, text: "x" }]))).toThrow()
    }),
  )

  it.effect("unpacks the archive it was told to expect and marks it installed", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = path.join((yield* tmpdirScoped()).path, "sketchy")

      expect(yield* Sketchy.installed(fs, root)).toBe(false)
      yield* Sketchy.install({ fs, http: serving(ARCHIVE) }, root, { url: Sketchy.URL, sha256: sha256(ARCHIVE) })

      expect(yield* fs.readFileStringSafe(path.join(root, "dist", "index.js"))).toBe("console.log('그림')")
      // The marker names the digest this version pins, so only the pinned archive counts as installed.
      expect(yield* Sketchy.installed(fs, root)).toBe(sha256(ARCHIVE) === Sketchy.SHA256)
    }),
  )

  it.effect("installs nothing when the download is not the pinned archive", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = path.join((yield* tmpdirScoped()).path, "sketchy")
      const error = yield* Sketchy.install({ fs, http: serving(ARCHIVE) }, root).pipe(Effect.flip)

      expect(error.reason).toContain("다릅니다")
      expect(yield* fs.existsSafe(root)).toBe(false)
    }),
  )

  it.effect("says the download failed in Korean when the release cannot be reached", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = path.join((yield* tmpdirScoped()).path, "sketchy")
      const calls: string[] = []
      const error = yield* Sketchy.install({ fs, http: serving(undefined, calls) }, root).pipe(Effect.flip)

      expect(calls).toEqual([Sketchy.URL])
      expect(error.reason).toContain("내려받지 못했습니다")
      expect(yield* Sketchy.installed(fs, root)).toBe(false)
    }),
  )

  it.effect("runs in the engine's own runtime, off until asked for, saving into the 작업실", () =>
    Effect.sync(() => {
      const server = Sketchy.server("C:/app/opencode.exe", "C:/data/jabisu/sketchy/v", "C:/data", "C:/work/room")

      expect(server.command).toEqual(["C:/app/opencode.exe", path.join("C:/data/jabisu/sketchy/v", "dist", "index.js")])
      expect(server.disabled).toBe(true)
      expect(server.environment).toMatchObject({
        BUN_BE_BUN: "1",
        SKETCHY_PHOTOS: "off",
        SKETCHY_STANDALONE_DIR: path.join("C:/work/room", "그림"),
      })
    }),
  )
})
