import type { ServerRef, Servers } from "./sdk"

// 자비수's extensions that read or write files on this PC (집현전, bundled skills, work folders) talk to the desktop's
// own server, whose engine runs here.

/** The desktop's own server. */
export const builtin = (servers: Servers) =>
  servers
    .list()
    .map((id) => servers.get(id))
    .find((item) => item?.builtin)

/** The Location a request to that server names: its default one. */
export const locationOf = (server: ServerRef) => ({ directory: server.data.location.default().directory })
