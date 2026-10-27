export * as JabisuSafety from "./safety.js"

import { Permission } from "../../permission.js"

// OpenCode lets agents do anything by default. 자비수 runs on office PCs, so it asks before the AI changes a file
// outside the 작업실 (the folder the session works in) and before it deletes, moves or writes files with a command.
// Reading stays free, so the work assistant can read the files it finds. A test with a real model found it working
// around a refused write with a shell redirect and a refused delete with `powershell -Command`, so commands are
// matched anywhere in their text, and every chat is also told not to work around a refusal.

// An edit inside the 작업실 names the file relative to it; one outside names it absolutely, by drive or network path.
const OUTSIDE = ["?:/*", "//*"]

// Short commands that delete or move files, asked for at the start of a command or after a space, as in
// `cmd /c del …` or `… && rm …`. Where a command points is not known reliably, so these ask wherever they point.
const COMMANDS = ["rm", "rmdir", "rd", "del", "erase", "mv", "move", "ri", "mi", "clc"]

// Commands and calls that delete, move, empty or write files, asked for anywhere in a command, so one wrapped in
// another, as in `powershell -Command "Remove-Item …"` or `python -c "os.remove(…)"`, asks too.
const CALLS = [
  "Remove-Item",
  "Move-Item",
  "Clear-Content",
  "Clear-Item",
  "Set-Content",
  "Add-Content",
  "Out-File",
  "Copy-Item",
  "::Delete(",
  "::Move(",
  "os.remove(",
  "os.unlink(",
  "shutil.rmtree(",
  "shutil.move(",
  ".unlink(",
]

// A shell redirect into a file named by drive, which is how a command writes outside the 작업실.
const REDIRECTS = ["*> ?:/*", '*> "?:/*', "*> '?:/*", "*>?:/*", '*>"?:/*']

export const rules: Permission.Ruleset = [
  ...OUTSIDE.map((resource) => ({ action: "edit", resource, effect: "ask" as const })),
  ...[
    ...COMMANDS.flatMap((command) => [`${command} *`, `* ${command} *`]),
    ...CALLS.map((call) => `*${call}*`),
    ...REDIRECTS,
  ].map((resource) => ({ action: "shell", resource, effect: "ask" as const })),
]

/** The rules every chat gets in words, for what a command can do that no rule above can see. */
export const INSTRUCTIONS = [
  "# 자비수 안전 규칙",
  "",
  "- 사용자가 거부했거나 허락하지 않은 작업은 셸·스크립트·다른 도구로 바꿔서 다시 하지 않는다. 막히면 멈추고, 무엇이 막혔는지와 사용자가 직접 할 방법을 알린다.",
  "- 작업실 밖의 파일을 셸로 만들거나 고치거나 옮기거나 지우지 않는다. 꼭 필요하면 write·edit 도구로 해서 사용자의 허락을 받는다.",
  "- 사용자의 파일을 찾을 때는 work_search와 작업실 안에서 찾는다. 사용자 폴더 전체나 바탕화면·다운로드·문서 폴더를 셸로 뒤지지 않는다. 못 찾으면 어디에 있는지 묻는다.",
  "- 법령·자치법규·판례는 law_search·law_text·law_verify로 찾고 확인한다. 법제처 Open API(law.go.kr의 DRF)를 직접 부르거나 인증키를 지어내거나 남의 키를 쓰지 않는다. 법령 찾기가 설정되지 않았으면 그 도구가 알려 주는 대로 한다.",
].join("\n")

// A resource each rule covers, to see what the agent does with it now.
const example = (pattern: string) => pattern.replaceAll("?", "C").replaceAll("*", "x")

/** The rules that make an agent ask where it now allows; a denial or a question it already has stays as it is. */
export function tightening(permissions: Permission.Ruleset): Permission.Ruleset {
  return rules.filter(
    (rule) => Permission.evaluate(rule.action, example(rule.resource), permissions).effect === "allow",
  )
}
