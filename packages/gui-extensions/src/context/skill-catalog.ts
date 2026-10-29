import { createMemo, createResource, type Accessor } from "solid-js"
import type { MountedSession } from "../sdk"

export type SkillGroup = "mine" | "bundled" | "other"

// Windows compares paths without case and with either separator.
const key = (file: string) => file.replaceAll("\\", "/").toLowerCase()

/**
 * Every skill the session can use, grouped by where it comes from: the user's own, the ones 자비수 bundles (with their
 * Korean names, whether they are on, and whether the user's copy replaces them), and the rest.
 */
export function createSkillCatalog(session: Accessor<MountedSession>) {
  // The session's skills may not be loaded yet; 자비수 says which are bundled and where the user's own live.
  const [bundled, { mutate }] = createResource(
    () => {
      const current = session()

      return { data: current.server.data, client: current.server.client, directory: current.directory }
    },
    async (input) => {
      await input.data.location.skill.sync({ directory: input.directory })

      return input.client.jabisu.skills.list({ location: { directory: input.directory } }).catch(() => undefined)
    },
  )

  const all = createMemo(() => {
    const current = session()
    const list = bundled.latest
    const named = new Map((list?.skills ?? []).map((skill) => [skill.name, skill]))
    const folder = list ? `${key(list.folder)}/` : undefined

    return (current.server.data.location.skill.list({ directory: current.directory }) ?? [])
      .map((skill) => {
        const known = named.get(skill.name)
        const group: SkillGroup = known ? "bundled" : folder && key(skill.path).startsWith(folder) ? "mine" : "other"

        return {
          name: skill.name,
          title: known?.title,
          // 자비수's Korean summary for its own skills, the skill's own description otherwise.
          text: known?.summary ?? skill.description ?? "",
          search: [skill.name, skill.description, known?.title, known?.summary, ...(known?.keywords ?? [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          path: skill.path,
          group,
          known,
        }
      })
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })

  return {
    all,
    /** Skills whose descriptions go with every request: all but the bundled ones turned off. */
    on: () => all().filter((skill) => skill.known?.on !== false),
    loading: () => bundled.loading,
    replace: mutate,
  }
}
