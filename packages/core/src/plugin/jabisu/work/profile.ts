export * as WorkProfile from "./profile.js"

import type { Global } from "@opencode/util/global"
import path from "path"

// The user's work profile: who they are at work and what they are in charge of, as a Markdown file they can read and
// edit, kept beside the 집현전 folder. Every session gets it as instructions, so requests are understood against the
// user's duties; the bundled work-profile skill writes it from the duty assignment table (사무분장표).

/** The folder 자비수 keeps the user's work files in. */
export const folder = (global: Pick<Global.Interface, "home">) => path.join(global.home, "Documents", "자비수 업무")

export const file = (global: Pick<Global.Interface, "home">) => path.join(folder(global), "내 업무.md")

// A profile is a page or two; a longer one is cut so it never crowds out the conversation.
const MAX_CHARS = 6_000

/** The instructions a session gets from the profile at `filepath`. */
export function instructions(filepath: string, content: string) {
  const body = content.trim()
  const cut = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n\n(이하 생략: 전체는 ${filepath})` : body

  return [
    "# 사용자의 업무 프로필 (자비수)",
    "",
    `아래는 이 사용자의 소속과 담당 업무다. 업무 요청은 이 업무 가운데 무엇에 해당하는지 먼저 생각하고, 관련 파일은 work_search 도구로 찾는다. 프로필에 없는 업무를 지어내지 않는다. 프로필 파일: ${filepath}`,
    "",
    cut,
  ].join("\n")
}
