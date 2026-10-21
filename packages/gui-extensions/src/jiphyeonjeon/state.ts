import { createSignal, type Accessor } from "solid-js"
import type { ServerRef, Servers } from "../sdk"

/** Lets every 집현전 view reload after any of them changes a 집현전, its sources or its instructions. */
export interface Sync {
  readonly revision: Accessor<number>
  readonly changed: () => void
}

export function createSync(): Sync {
  const [revision, setRevision] = createSignal(0)

  return { revision, changed: () => setRevision((value) => value + 1) }
}

/** The desktop's own server, which keeps the 집현전 folders on this PC. */
export const builtin = (servers: Servers) =>
  servers
    .list()
    .map((id) => servers.get(id))
    .find((item) => item?.builtin)

export const locationOf = (server: ServerRef) => ({ directory: server.data.location.default().directory })

const comparable = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()

/** Whether two paths name the same folder, whatever their separators or, as on Windows, their case. */
export const sameDirectory = (a: string, b: string) => comparable(a) === comparable(b)
