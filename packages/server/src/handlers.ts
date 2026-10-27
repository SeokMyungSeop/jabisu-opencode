import { Layer } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { GenerateHandler } from "./handlers/generate"
import { VoiceHandler } from "./handlers/voice"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { FileSystemHandler } from "./handlers/fs"
import { FormHandler } from "./handlers/form"
import { CommandHandler } from "./handlers/command"
import { SkillHandler } from "./handlers/skill"
import { RpcHandler } from "./handlers/rpc"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { PluginHandler } from "./handlers/plugin"
import { ServerHandler } from "./handlers/server"
import { DebugHandler } from "./handlers/debug"
import { PtyHandler } from "./handlers/pty"
import { PersistentPtyHandler } from "./handlers/persistent-pty"
import { ShellHandler } from "./handlers/shell"
import { ReferenceHandler } from "./handlers/reference"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { WebSearchHandler } from "./handlers/websearch"
import { McpHandler } from "./handlers/mcp"
import { CredentialHandler } from "./handlers/credential"
import { ProjectHandler } from "./handlers/project"
import { WorktreeHandler } from "./handlers/worktree"
import { VcsHandler } from "./handlers/vcs"
import { EventFeed } from "./event-feed"
import { MigrationHandler } from "./handlers/migration"
import { ConfigHandler } from "./handlers/config"
import { JabisuHandler, JabisuWorkIndexer } from "./handlers/jabisu"

export const handlers = Layer.mergeAll(
  ServerHandler,
  DebugHandler,
  MigrationHandler,
  LocationHandler,
  AgentHandler,
  PluginHandler,
  SessionHandler,
  MessageHandler,
  ModelHandler,
  GenerateHandler,
  VoiceHandler,
  ProviderHandler,
  IntegrationHandler,
  WebSearchHandler,
  McpHandler,
  CredentialHandler,
  ProjectHandler,
  FormHandler,
  PermissionHandler,
  FileSystemHandler,
  CommandHandler,
  SkillHandler,
  RpcHandler,
  EventHandler.pipe(Layer.provide(EventFeed.layer)),
  PtyHandler,
  PersistentPtyHandler,
  ShellHandler,
  ReferenceHandler,
  WorktreeHandler,
  VcsHandler,
  ConfigHandler,
  // The settings file is read and written with the shared filesystem helpers, which no application service exports.
  JabisuHandler.pipe(Layer.provide(LayerNode.compile(FSUtil.node))),
  // 자비수's work index follows the folders the user chose while the server runs.
  JabisuWorkIndexer.pipe(Layer.provide(LayerNode.compile(FSUtil.node))),
)
