export * as JabisuSkills from "./skills.js"

import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Data, Effect } from "effect"
import path from "path"
import { SkillFile } from "../../config/plugin/skill-file.js"
import { JabisuBundle } from "./bundle.js"
import { FilmCraft } from "./filmcraft.js"
import pythonHelper from "./python/jabisu_python.py" with { type: "text" }
import pythonSetup from "./python/python-setup.md" with { type: "text" }

// 자비수's bundled skills, and the user's own copies of them. A copy in the user's skills folder with a bundled
// skill's folder name replaces it, and updates never touch that folder, so a copy keeps the user's changes. Each copy
// records the bundled version it started from, so the app can ask whether to keep it when that skill changes.

export interface Dependencies {
  readonly fs: FSUtil.Interface
  readonly global: Global.Interface
}

/** A skill file by its path under the skills folder; binary files hold their bytes. */
export interface File {
  readonly path: string
  readonly content: string | Uint8Array
}

/** A bundled skill and its files, with paths under its own folder. */
export interface Bundled {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly files: readonly File[]
}

/** `default`: no copy of the user's; `custom`: a copy of the current version; `changed`: a copy of an older one. */
export type Status = "default" | "custom" | "changed"

export class SkillsError extends Data.TaggedError("JabisuSkillsError")<{ readonly reason: string }> {}

// The document skills share one Python package folder, which outlives the skill folder each update rewrites.
const PYTHON_SKILLS = ["docx", "hwpx", "pptx", "xlsx"]

/** The file in a user's copy that names the bundled version it started from. */
export const BASE = ".jabisu-base"

/** The user's skills folder, which 자비수 loads after its own and never rewrites. */
export const folder = (global: Pick<Global.Interface, "config">) => path.join(global.config, "skills")

/** Where copies the user stopped using are moved, outside the skills folder so they no longer load. */
export const backups = (global: Pick<Global.Interface, "config">) => path.join(global.config, "skills-backup")

/** Every bundled skill file, with the files 자비수 fills in for this PC. */
export const files = Effect.fn("JabisuSkills.files")(function* (deps: Dependencies) {
  const helper = pythonHelper.replace("__JABISU_PYTHON__", path.join(deps.global.data, "jabisu", "python"))
  const embedded = yield* Effect.forEach(JabisuBundle.files, (file) =>
    Effect.gen(function* () {
      // Binary files are embedded in the CLI, so failing to read one is a build defect.
      return {
        path: file.path,
        content: "text" in file ? file.text : yield* deps.fs.readFile(file.file).pipe(Effect.orDie),
      } satisfies File
    }),
  )

  return [
    ...embedded,
    ...PYTHON_SKILLS.flatMap((skill) => [
      { path: `${skill}/scripts/jabisu_python.py`, content: helper },
      { path: `${skill}/python-setup.md`, content: pythonSetup },
    ]),
    {
      path: "craft-apps/scripts/start-filmcraft.ps1",
      content: FilmCraft.launcher(FilmCraft.tokenFile(deps.global.data)),
    },
  ] satisfies File[]
})

/** The bundled skills, each with a version that changes whenever any of its files does. */
export function bundled(all: readonly File[]): Bundled[] {
  const byName = new Map<string, File[]>()

  for (const file of all) {
    const [name, ...rest] = file.path.split("/")

    if (!name || rest.length === 0) continue
    byName.set(name, [...(byName.get(name) ?? []), { path: rest.join("/"), content: file.content }])
  }

  return [...byName.entries()].flatMap(([name, items]) => {
    const skill = items.find((file) => file.path === "SKILL.md")

    if (!skill || typeof skill.content !== "string") return []
    const parsed = SkillFile.parse(path.join("skills", name), path.join("skills", name, "SKILL.md"), skill.content)
    const sorted = items.toSorted((a, b) => a.path.localeCompare(b.path))

    return [
      {
        name,
        description: parsed._tag === "Parsed" ? (parsed.skill.description ?? "") : "",
        version: Hash.fast(sorted.map((file) => `${file.path}\0${Hash.fast(Buffer.from(file.content))}`).join("\0")),
        files: sorted,
      },
    ]
  })
}

const copyOf = (deps: Dependencies, name: string) => path.join(folder(deps.global), name)

const readBase = (deps: Dependencies, name: string) =>
  deps.fs.readFileStringSafe(path.join(copyOf(deps, name), BASE)).pipe(
    Effect.map((text) => text?.trim()),
    Effect.orElseSucceed(() => undefined),
  )

const hasCopy = (deps: Dependencies, name: string) =>
  deps.fs.existsSafe(path.join(copyOf(deps, name), "SKILL.md"))

const status = Effect.fn("JabisuSkills.status")(function* (deps: Dependencies, skill: Bundled) {
  if (!(yield* hasCopy(deps, skill.name))) return "default" as const
  const base = yield* readBase(deps, skill.name)

  // A copy made by hand has no base until 자비수 first sees it, which counts it as made from the current version.
  return base === undefined || base === skill.version ? ("custom" as const) : ("changed" as const)
})

/** Each bundled skill with whether the user has their own copy, and the folders the app shows. */
export const list = Effect.fn("JabisuSkills.list")(function* (deps: Dependencies) {
  const skills = bundled(yield* files(deps))

  return {
    folder: folder(deps.global),
    backups: backups(deps.global),
    skills: yield* Effect.forEach(skills, (skill) =>
      Effect.gen(function* () {
        const state = yield* status(deps, skill)

        return {
          name: skill.name,
          description: skill.description,
          status: state,
          ...(state === "default" ? {} : { directory: copyOf(deps, skill.name) }),
        }
      }),
    ),
  }
})

const find = Effect.fn("JabisuSkills.find")(function* (deps: Dependencies, name: string) {
  const skill = bundled(yield* files(deps)).find((item) => item.name === name)

  if (!skill) return yield* new SkillsError({ reason: `${name} is not a bundled skill` })

  return skill
})

/** Copies a bundled skill into the user's skills folder, where it replaces the bundled one and survives updates. */
export const copy = Effect.fn("JabisuSkills.copy")(function* (deps: Dependencies, name: string) {
  const skill = yield* find(deps, name)
  const target = copyOf(deps, name)

  if (yield* deps.fs.existsSafe(target)) return yield* new SkillsError({ reason: `${target} already exists` })
  yield* Effect.forEach(skill.files, (file) => deps.fs.writeWithDirs(path.join(target, file.path), file.content)).pipe(
    Effect.andThen(deps.fs.writeWithDirs(path.join(target, BASE), skill.version)),
    Effect.mapError(() => new SkillsError({ reason: `${target} cannot be written` })),
  )

  return target
})

/** Keeps the user's copy after the bundled skill changed: the copy now counts as made from the current version. */
export const keep = Effect.fn("JabisuSkills.keep")(function* (deps: Dependencies, name: string) {
  const skill = yield* find(deps, name)

  if (!(yield* hasCopy(deps, name))) return yield* new SkillsError({ reason: `there is no copy of ${name}` })
  yield* deps.fs
    .writeWithDirs(path.join(copyOf(deps, name), BASE), skill.version)
    .pipe(Effect.mapError(() => new SkillsError({ reason: `${copyOf(deps, name)} cannot be written` })))
})

/** Goes back to the bundled skill by moving the user's copy into the backup folder. Returns where it went. */
export const reset = Effect.fn("JabisuSkills.reset")(function* (deps: Dependencies, name: string, now: Date) {
  yield* find(deps, name)
  const source = copyOf(deps, name)

  if (!(yield* deps.fs.existsSafe(source))) return yield* new SkillsError({ reason: `there is no copy of ${name}` })
  const target = path.join(backups(deps.global), `${name}-${stamp(now)}`)

  yield* deps.fs.makeDirectory(backups(deps.global), { recursive: true }).pipe(
    Effect.andThen(deps.fs.rename(source, target)),
    Effect.mapError(() => new SkillsError({ reason: `${source} cannot be moved to ${target}` })),
  )

  return target
})

/** Records the current version in copies that have none yet, so a later change of that skill is noticed. */
export const baseline = Effect.fn("JabisuSkills.baseline")(function* (deps: Dependencies, skills: readonly Bundled[]) {
  yield* Effect.forEach(skills, (skill) =>
    Effect.gen(function* () {
      if (!(yield* hasCopy(deps, skill.name)) || (yield* readBase(deps, skill.name)) !== undefined) return
      yield* deps.fs.writeWithDirs(path.join(copyOf(deps, skill.name), BASE), skill.version).pipe(Effect.ignore)
    }),
  )
})

/** A local time such as `20261026-101500`. */
function stamp(date: Date) {
  const two = (value: number) => String(value).padStart(2, "0")

  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}
