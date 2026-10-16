import { expect } from "bun:test"
import { LLMClient, ToolDefinition } from "@opencode/ai"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { Instance } from "@opencode/core/instance/service"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Instructions } from "@opencode/core/instructions/index"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Project } from "@opencode/core/project"
import { ReferenceInstructions } from "@opencode/core/reference/instructions"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionContext } from "@opencode/core/session/context"
import { SessionContextUsage } from "@opencode/core/session/context-usage"
import { SessionEvent } from "@opencode/core/session/event"
import { InstructionState } from "@opencode/core/session/instruction-state"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { Tool } from "@opencode/core/tool"
import { Token } from "@opencode/core/util/token"
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "./lib/effect"

const sessionID = SessionSchema.ID.make("ses_context_usage_test")
const text = {
  environment: "Working directory: /project",
  instructions: "Follow the project rules in AGENTS.md before editing.",
  skills: "Skills available: deploy, review",
  mcp: "The GitHub server searches issues and pull requests.",
  prompt: "Existing durable context",
}
// The MCP servers whose tools the Code Mode catalog lists; a test empties it to see their share stay in tools.
const servers = { list: [Mcp.ServerName.make("github")] }

const source = (key: string, value: string) =>
  Instructions.make({
    key: Instructions.Key.make(key),
    codec: Schema.toCodecJson(Schema.String),
    read: Effect.succeed(value),
    render: { initial: String, changed: (_previous, current) => current },
  })

const model = LanguageModel.make({ id: "usage-model", provider: "test", route: OpenAIChat.route })

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Project.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      InstructionBuiltIns.node,
      SessionContext.node,
      PluginHooks.node,
      llmClient,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      llmClient.replace(
        Layer.mock(LLMClient.Service)({
          stream: () => Stream.die(new Error("unused")),
          generate: () => Effect.die(new Error("unused")),
        }),
      ),
      SessionRunnerModel.node.replace(
        Layer.mock(SessionRunnerModel.Service)({
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(model, {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: [],
                limit: { context: 200_000, output: 32_000 },
              }),
            ),
        }),
      ),
      InstructionBuiltIns.node.replace(
        Layer.mock(InstructionBuiltIns.Service, {
          load: () => Effect.succeed(source("core/environment", text.environment)),
        }),
      ),
      InstructionDiscovery.node.replace(
        Layer.mock(InstructionDiscovery.Service, {
          project: true,
          global: true,
          load: () => Effect.succeed(source("core/instructions", text.instructions)),
        }),
      ),
      SkillInstructions.node.replace(
        Layer.mock(SkillInstructions.Service, {
          load: () => Effect.succeed(source("core/skill-guidance", text.skills)),
        }),
      ),
      ReferenceInstructions.node.replace(
        Layer.mock(ReferenceInstructions.Service, { load: () => Effect.succeed(Instructions.empty) }),
      ),
      McpInstructions.node.replace(
        Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(source("core/mcp-guidance", text.mcp)) }),
      ),
      PluginSupervisor.node.replace(Layer.empty),
      Tool.node.replace(
        Layer.mock(Tool.Service, {
          snapshot: () =>
            Effect.succeed({
              codeModeCatalog: {
                tools: [
                  {
                    type: "tool",
                    name: "files.read",
                    description: "Read a workspace file",
                    signature: "tools.files.read(input: { path: string }): Promise<string>",
                  },
                  {
                    type: "namespace",
                    name: "github",
                    description: "GitHub",
                    tools: [
                      {
                        type: "tool",
                        name: "search",
                        description: "Search issues and pull requests across every repository the token can read",
                        signature: "tools.github.search(input: { query: string; limit?: number }): Promise<string>",
                      },
                    ],
                  },
                ],
              },
              definitions: [ToolDefinition.make({ name: "execute", description: "Run code", inputSchema: {} })],
              execute: () => Effect.die(new Error("unused")),
            }),
          transform: () => Effect.die(new Error("unused")),
        }),
      ),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    ],
  ),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const bus = yield* Bus.Service
  const agents = yield* Agent.Service
  const projects = yield* Project.Service
  const context = yield* SessionContext.Service
  const store = yield* SessionStore.Service
  yield* agents.transform((editor) =>
    editor.update(Agent.ID.make("build"), (agent) => {
      agent.mode = "primary"
    }),
  )
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: (yield* projects.resolve(AbsolutePath.make("/project"))).id,
      slug: "context-usage-test",
      directory: "/project",
      title: "Context usage test",
      version: "test",
      agent: Agent.ID.make("build"),
    })
    .run()
    .pipe(Effect.orDie)
  const session = yield* store.get(sessionID)
  if (!session) return yield* Effect.die("Session fixture missing")
  const selection = yield* context.select(sessionID)
  yield* InstructionState.prepare(db, bus, selection.instructions, sessionID)
  const prompt = SessionMessage.ID.create()
  yield* bus.publish(SessionEvent.InboxEnqueued, {
    sessionID,
    inboxID: prompt,
    item: { type: "user", payload: { text: text.prompt }, delivery: "steer" },
  })
  yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: prompt })
  const instances = Instance.Service.of({
    // The estimate reads only the Location's model context and MCP tools.
    provide: () =>
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(SessionContext.Service, context),
          Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
          Layer.mock(Mcp.Service, {
            tools: () =>
              Effect.succeed(
                servers.list.map((server) => ({ server, name: "search", inputSchema: { type: "object" } })),
              ),
          }),
        ) as Layer.Layer<Instance.Services>,
      ),
  })
  const estimate = SessionContextUsage.estimate({ session }).pipe(
    Effect.provideService(Instance.Service, instances),
    Effect.map((usage) => Object.fromEntries(usage.categories.map((entry) => [entry.category, entry.tokens]))),
  )
  return { estimate }
})

it.effect(
  "attributes each instruction source, MCP tools and the conversation to their own category",
  () =>
    Effect.gen(function* () {
      const { estimate } = yield* setup

      servers.list = [Mcp.ServerName.make("github")]
      const withServer = yield* estimate
      servers.list = []
      const withoutServer = yield* estimate

      expect(withServer.instructions).toBe(Token.estimate(text.instructions))
      expect(withServer.skills).toBe(Token.estimate(text.skills))
      expect(withServer.messages).toBe(Token.estimate(text.prompt))
      expect(withServer.system).toBeGreaterThan(Token.estimate(text.environment))
      // Without its server the namespace's catalog lines stay with the tools; with it they move to MCP.
      expect(withoutServer.mcp).toBe(Token.estimate(text.mcp))
      expect(withServer.mcp).toBeGreaterThan(withoutServer.mcp)
      expect(withServer.tools + withServer.mcp).toBe(withoutServer.tools + withoutServer.mcp)
    }),
  { timeout: 15_000 },
)
