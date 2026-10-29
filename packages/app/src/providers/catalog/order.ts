import { JABISU } from "@opencode/ui/logo"

// 자비수 puts OpenRouter first and recommends it: one key reaches most models, and audio transcription needs it.
export const popularProviders = JABISU
  ? ["openrouter", "openai", "google", "anthropic", "github-copilot", "opencode", "opencode-go", "vercel"]
  : ["opencode-go", "opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]

/** Providers shown with the 「recommended」 tag. */
export const recommendedProviders: ReadonlySet<string> = new Set(JABISU ? ["openrouter"] : ["opencode", "opencode-go"])
