export * as JabisuWorkflow from "./workflow.js"

// 자비수 draws the AI's to-do list as the 진행 흐름 above the composer, so the list is asked for in the user's words.
// The new-conversation chips fill the composer with a question frame whose blanks carry 「(예: …)」 examples; a blank
// the user left must not be read as their answer.
export const INSTRUCTIONS = [
  "# 자비수 진행 흐름",
  "",
  "- 단계가 셋 이상인 일을 맡으면 먼저 todowrite로 할 일 목록을 쓴다. 사용자는 이 목록을 화면의 「진행 흐름」으로 본다.",
  '- 할 일은 사용자의 말(한국어면 한국어)로, 15자 안쪽의 짧은 말로 쓴다. 예: "자료 읽기", "집행률 계산", "보고서 작성".',
  "- 한 단계를 시작하면 in_progress로, 끝내면 바로 completed로 고친다.",
  "",
  "# 질문 틀",
  "",
  "- 사용자 메시지가 「- 항목: 값」 줄로 된 질문 틀이면, 「(예: …)」가 그대로 남은 부분은 사용자가 채우지 않은 예시다. 예시를 사용자의 값으로 쓰지 않는다.",
  "- 일을 하는 데 꼭 필요한데 비어 있는 칸만 question 도구로 한 번에 묻는다. 없어도 되는 칸은 알맞게 정하고, 무엇으로 정했는지 답에 알린다.",
].join("\n")
