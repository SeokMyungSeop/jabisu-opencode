import { JABISU } from "@opencode/ui/logo"

// 자비수 puts its free console first, for trying it with no key, and OpenRouter next: one key reaches most models, and
// audio transcription needs it.
export const popularProviders = JABISU
  ? [
      "jabisu-free",
      "openrouter",
      "openai",
      "google",
      "anthropic",
      "github-copilot",
      "opencode",
      "opencode-go",
      "vercel",
    ]
  : ["opencode-go", "opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]

/** Providers shown with the 「recommended」 tag. */
export const recommendedProviders: ReadonlySet<string> = new Set(
  JABISU ? ["jabisu-free", "openrouter"] : ["opencode", "opencode-go"],
)
