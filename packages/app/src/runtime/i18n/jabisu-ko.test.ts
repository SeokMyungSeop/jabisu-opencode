import { describe, expect, test } from "bun:test"
import { dict as app } from "./ko"
import { dict as ui } from "@opencode/ui/i18n/ko"
import { conversation, jabisuKorean, workroom } from "./jabisu-ko"

describe("자비수 Korean", () => {
  test("calls a project 「작업실」 and fits the particle after it", () => {
    expect(workroom("프로젝트를 찾을 수 없습니다")).toBe("작업실을 찾을 수 없습니다")
    expect(workroom("모든 프로젝트와 공유됨")).toBe("모든 작업실과 공유됨")
    expect(workroom("프로젝트가 없습니다")).toBe("작업실이 없습니다")
    expect(workroom("프로젝트는 폴더입니다")).toBe("작업실은 폴더입니다")
    expect(workroom("프로젝트로 돌아가기")).toBe("작업실로 돌아가기")
    expect(workroom("이 프로젝트의 설정")).toBe("이 작업실의 설정")
  })

  test("calls a session 「대화」, a new one 「새 대화창」, and fits the particle after it", () => {
    expect(conversation("새 세션")).toBe("새 대화창")
    expect(conversation("새 세션으로 분기")).toBe("새 대화창으로 분기")
    expect(conversation("새 세션이 시작되는 위치")).toBe("새 대화창이 시작되는 위치")
    expect(conversation("세션을 내보냈습니다")).toBe("대화를 내보냈습니다")
    expect(conversation("세션이 없는 작업 트리")).toBe("대화가 없는 작업 트리")
    expect(conversation("공급자가 세션을 압축함")).toBe("공급자가 대화를 압축함")
    expect(conversation("메인 세션으로 돌아가기")).toBe("메인 대화로 돌아가기")
    expect(conversation("작업 공간으로 세션 격리")).toBe("작업 공간으로 대화 격리")
    expect(conversation("하위 에이전트 세션에는")).toBe("하위 에이전트 대화에는")
  })

  test("leaves no 「프로젝트」 or 「세션」 in the app's Korean strings, and keeps every key", () => {
    const shown: Record<string, string> = jabisuKorean({ ...app, ...ui })

    expect(Object.values(shown).filter((value) => value.includes("프로젝트") || value.includes("세션"))).toEqual([])
    expect(Object.keys(shown)).toEqual(expect.arrayContaining(Object.keys({ ...app, ...ui })))
    expect(shown["home.project.add"]).toBe("작업실 추가")
    expect(shown["desktop.onboarding.defaultProject"]).toBe("기본 작업실")
    expect(shown["settings.projects.empty.title"]).toBe("아직 작업실이 없습니다")
    expect(shown["command.session.new"]).toBe("새 대화창")
    expect(shown["home.sessions.search.placeholder"]).toBe("대화 검색")
  })
})
