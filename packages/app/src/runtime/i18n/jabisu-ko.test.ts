import { describe, expect, test } from "bun:test"
import { dict as app } from "./ko"
import { dict as ui } from "@opencode/ui/i18n/ko"
import { jabisuKorean, workroom } from "./jabisu-ko"

describe("자비수 Korean", () => {
  test("calls a project 「작업실」 and fits the particle after it", () => {
    expect(workroom("프로젝트를 찾을 수 없습니다")).toBe("작업실을 찾을 수 없습니다")
    expect(workroom("모든 프로젝트와 공유됨")).toBe("모든 작업실과 공유됨")
    expect(workroom("프로젝트가 없습니다")).toBe("작업실이 없습니다")
    expect(workroom("프로젝트는 폴더입니다")).toBe("작업실은 폴더입니다")
    expect(workroom("프로젝트로 돌아가기")).toBe("작업실로 돌아가기")
    expect(workroom("이 프로젝트의 설정")).toBe("이 작업실의 설정")
  })

  test("leaves no 「프로젝트」 in the app's Korean strings, and keeps every key", () => {
    const shown: Record<string, string> = jabisuKorean({ ...app, ...ui })

    expect(Object.values(shown).filter((value) => value.includes("프로젝트"))).toEqual([])
    expect(Object.keys(shown)).toEqual(expect.arrayContaining(Object.keys({ ...app, ...ui })))
    expect(shown["home.project.add"]).toBe("작업실 추가")
    expect(shown["desktop.onboarding.defaultProject"]).toBe("기본 작업실")
    expect(shown["settings.projects.empty.title"]).toBe("아직 작업실이 없습니다")
  })
})
