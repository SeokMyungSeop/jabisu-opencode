import type { ServerRef, Servers } from "../sdk"

/** The desktop's own server, whose engine keeps the bundled skills and the user's skills folder on this PC. */
export const builtin = (servers: Servers) =>
  servers
    .list()
    .map((id) => servers.get(id))
    .find((item) => item?.builtin)

export const locationOf = (server: ServerRef) => ({ directory: server.data.location.default().directory })
