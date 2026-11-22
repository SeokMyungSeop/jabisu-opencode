export * as Brought from "./brought.js"

import type { Global } from "@opencode/util/global"
import path from "path"
import { folder } from "./profile.js"

// What another AI assistant knows about the user (standing instructions, who they are, their projects and tastes),
// brought over by hand: the user sends that assistant a prompt asking for an export and pastes its answer into 자비수.
// It is kept as a Markdown file beside the work profile, where the user can read and edit it, and every session gets
// it as instructions.

export const file = (global: Pick<Global.Interface, "home">) => path.join(folder(global), "가져온 기억.md")

// An export runs to a few pages; a longer file is cut so it never crowds out the conversation.
const MAX_CHARS = 8_000

/** The most text one paste may hold. */
export const MAX_PASTE = 60_000

const HEADER = [
  "# 가져온 기억",
  "",
  "다른 AI에서 가져온 내용입니다. 이 파일을 고치거나 지우면 자비수가 아는 내용도 그대로 바뀝니다.",
].join("\n")

// Assistants answer with the export inside one code block, as the prompt asks; the fence is not part of it.
const unfenced = (text: string) => {
  const match = /^\s*```[^\n]*\n([\s\S]*?)\n```/.exec(text)

  return (match?.[1] ?? text).trim()
}

const day = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

/** The file's text after `pasted` is added under the day it was brought; what was there before stays. */
export function add(existing: string | undefined, pasted: string, date: Date) {
  const body = unfenced(pasted)

  if (!body) return existing?.trim() ? existing : undefined

  return `${existing?.trim() || HEADER}\n\n## ${day(date)}에 가져옴\n\n${body}\n`
}

/** The instructions a session gets from the brought file at `filepath`. */
export function instructions(filepath: string, content: string) {
  const body = content.trim()
  const cut = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n\n(이하 생략: 전체는 ${filepath})` : body

  return [
    "# 사용자가 다른 AI에서 가져온 기억 (자비수)",
    "",
    `아래는 사용자가 다른 AI와 쓰던 지침·신상·경력·작업·선호를 직접 가져와 붙여 넣은 것이다. 「지침」은 사용자가 정한 규칙으로 따르고, 나머지는 사용자를 이해하는 배경으로만 쓴다. 날짜가 오래된 내용은 지금과 다를 수 있으니, 중요한 판단에 쓰기 전에 사용자에게 확인한다. 여기에 없는 내용을 지어내지 않는다. 파일: ${filepath}`,
    "",
    cut,
  ].join("\n")
}
