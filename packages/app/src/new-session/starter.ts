import { isAttachment } from "@/composer/prompt-parts"
import type { Prompt } from "@/composer/state"

/** 자비수's common office work. A chip fills the composer with that work's question frame. */
export const STARTERS = ["report", "minutes", "press", "law", "automation"] as const

export type Starter = (typeof STARTERS)[number]

/** The frame as composer parts, keeping files already dropped in, and where the caret goes: after the first blank's label. */
export function starterPrompt(frame: string, current: Prompt) {
  const first = frame.indexOf(": ")

  return {
    prompt: [
      { type: "text" as const, content: frame, start: 0, end: frame.length },
      ...current.filter(isAttachment),
    ] satisfies Prompt,
    cursor: first === -1 ? frame.length : first + 2,
  }
}

/** Whether the composer has no words yet; files dropped in first still leave room for a frame. */
export function starterRoom(current: Prompt) {
  return current.every((part) => isAttachment(part) || part.content.trim() === "")
}
