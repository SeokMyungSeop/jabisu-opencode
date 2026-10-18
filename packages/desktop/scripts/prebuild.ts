#!/usr/bin/env bun
import { $ } from "bun"

import { copyBuiltCliToResources, downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

// A redistribution ships its own CLI: the published ones lack its server changes.
if ((channel === "prod" || channel === "jabisu") && !Bun.env.OPENCODE_CLI_DIST) {
  throw new Error(`OPENCODE_CLI_DIST is required for ${channel} desktop builds`)
}

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun ./scripts/copy-metainfo.ts ${channel}`

if (channel === "dev") await downloadCliToResources()

if ((channel === "beta" || channel === "prod" || channel === "jabisu") && Bun.env.OPENCODE_CLI_DIST) {
  await copyBuiltCliToResources(Bun.env.OPENCODE_CLI_DIST)
}

if (channel === "beta" && !Bun.env.OPENCODE_CLI_DIST) await downloadCliToResources("beta")
