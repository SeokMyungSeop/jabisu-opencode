export * as JabisuWorkflow from "./workflow.js"

// 자비수 draws the AI's to-do list as the 진행 흐름 above the composer, so the list is asked for in the user's words.
export const INSTRUCTIONS = [
  "# 자비수 진행 흐름",
  "",
  "- 단계가 셋 이상인 일을 맡으면 먼저 todowrite로 할 일 목록을 쓴다. 사용자는 이 목록을 화면의 「진행 흐름」으로 본다.",
  '- 할 일은 사용자의 말(한국어면 한국어)로, 15자 안쪽의 짧은 말로 쓴다. 예: "자료 읽기", "집행률 계산", "보고서 작성".',
  "- 한 단계를 시작하면 in_progress로, 끝내면 바로 completed로 고친다.",
].join("\n")
