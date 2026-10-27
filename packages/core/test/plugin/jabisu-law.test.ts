import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LawCitation } from "@opencode/core/plugin/jabisu/law/citation"
import { LawSettings } from "@opencode/core/plugin/jabisu/law/settings"
import { LawTools } from "@opencode/core/plugin/jabisu/law/tools"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node])))

const KEY = "jabisu-test-key"

// Answers shaped like law.go.kr's: a list of one as a bare object, empty fields left out.
const LAWS = [
  {
    법령ID: "001461",
    법령명한글: "산업기술혁신 촉진법",
    법령약칭명: "산업기술혁신법",
    법령구분명: "법률",
    소관부처명: "산업통상부",
    시행일자: "20260918",
    현행연혁코드: "현행",
  },
  {
    법령ID: "003778",
    법령명한글: "산업기술혁신 촉진법 시행령",
    법령구분명: "대통령령",
    소관부처명: "산업통상부",
    시행일자: "20260603",
    현행연혁코드: "현행",
  },
]

const BASIC = {
  법령명_한글: "산업기술혁신 촉진법",
  시행일자: "20260918",
  법종구분: { content: "법률", 법종구분코드: "A0002" },
  소관부처: { content: "산업통상부", 소관부처코드: "1451000" },
}

const ARTICLE_11 = {
  법령: {
    기본정보: BASIC,
    조문: {
      조문단위: [
        { 조문번호: "11", 조문내용: "제3장 산업기술개발사업의 추진 및 사업화", 조문여부: "전문" },
        {
          조문번호: "11",
          조문시행일자: "20260918",
          조문내용: "제11조(산업기술개발사업)",
          조문여부: "조문",
          항: [
            { 항번호: "①", 항내용: "① 산업통상부장관은 기술개발사업을 추진할 수 있다." },
            {
              항번호: "②",
              항내용: "② 산업통상부장관은 다음 각 호의 자와 협약을 체결할 수 있다.",
              호: [
                { 호번호: "1.", 호내용: "1. 주관연구기관" },
                { 호번호: "2.", 호내용: "2. 참여기관" },
              ],
            },
          ],
        },
      ],
    },
  },
}

const DECREE_4 = {
  법령: {
    기본정보: { ...BASIC, 법령명_한글: "산업기술혁신 촉진법 시행령", 법종구분: { content: "대통령령" } },
    조문: {
      조문단위: {
        조문번호: "4",
        조문내용: "제4조(삭제) 삭제 <2013.3.23>",
        조문여부: "조문",
      },
    },
  },
}

const ORDINANCE = "강원특별자치도 그린바이오산업 육성 및 지원 조례"

// An ordinance's text runs its items together, as law.go.kr serves it.
const ORDINANCE_TEXT = {
  LawService: {
    자치법규기본정보: { 자치법규명: ORDINANCE, 지자체기관명: "강원특별자치도", 시행일자: "20250502" },
    조문: {
      조: [
        { 조문번호: ["000100", "000100"], 조내용: "제1조(목적) 이 조례는 그린바이오산업의 육성을 목적으로 한다." },
        {
          조문번호: ["000700", "000700"],
          조내용:
            "제7조(육성 사업) 도지사는 다음 각 호의 사업을 할 수 있다.1. 전문인력 양성2. 기술 등의 연구·개발·보급3. 「농업생명자원법」 제2조제1호에 따른 데이터 활용",
        },
      ],
    },
  },
}

// A fake law.go.kr; `failures` makes the named target answer with a server error.
const server = (failures: readonly string[] = []) => {
  const calls: URLSearchParams[] = []
  const http = HttpClient.make((request, url) => {
    const params = url.searchParams
    const target = params.get("target") ?? ""
    const json = (body: unknown, status = 200) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status })))

    calls.push(params)
    if (failures.includes(target)) return json({ error: "down" }, 500)
    // law.go.kr answers a key it cannot verify with 200 and its reason.
    if (target === "expc")
      return json({ result: "사용자 정보 검증에 실패하였습니다.", msg: "정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요." })
    if (url.pathname.endsWith("lawSearch.do")) {
      const query = (params.get("query") ?? "").replace(/\s/g, "")
      if (target === "law" && ["산업기술혁신촉진법시행령", "산업기술혁신법"].some((name) => name.startsWith(query)))
        return json({ LawSearch: { totalCnt: "2", law: LAWS } })
      if (target === "law") return json({ LawSearch: { totalCnt: "0" } })
      if (target === "ordin" && query === ORDINANCE.replace(/\s/g, ""))
        return json({ OrdinSearch: { totalCnt: "1", law: { 자치법규일련번호: "2035933", 자치법규명: ORDINANCE } } })
      if (target === "ordin") return json({ OrdinSearch: { totalCnt: "0" } })
      if (target === "admrul") return json({ AdmRulSearch: { totalCnt: "0" } })
      return json({ PrecSearch: { totalCnt: "0" } })
    }
    const id = params.get("ID")
    const jo = params.get("JO")
    if (id === "001461" && jo === "001100") return json(ARTICLE_11)
    if (id === "003778" && jo === "000400") return json(DECREE_4)
    if (params.get("MST") === "2035933") return json(ORDINANCE_TEXT)
    return json({ 법령: { 기본정보: BASIC } })
  })

  return { http, calls }
}

const setup = (options: { key?: boolean; failures?: readonly string[] } = {}) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = { config: (yield* tmpdirScoped()).path }
    const fake = server(options.failures)

    if (options.key !== false) yield* LawSettings.write({ fs, global }, KEY)

    return { tools: LawTools.tools({ fs, global, http: fake.http }), calls: fake.calls, fs, global }
  })

describe("LawCitation", () => {
  it.live("finds articles cited in official writing, with 같은 법 pointing back", () =>
    Effect.sync(() => {
      const found = LawCitation.find(
        "「산업기술혁신 촉진법」(이하 “법”이라 한다) 제11조제2항제1호에 따라 협약을 맺고, 같은 법 시행령 제4조와 「보조금 관리에 관한 법률」 제26조의2 제1항, 다시 「산업기술혁신 촉진법」 제11조 제2항 제1호를 본다.",
      )

      expect(found.map((item) => `${item.name} ${LawCitation.label(item)}`)).toEqual([
        "산업기술혁신 촉진법 제11조 제2항 제1호",
        "산업기술혁신 촉진법 시행령 제4조",
        "보조금 관리에 관한 법률 제26조의2 제1항",
      ])
    }),
  )

  it.live("reads articles as people write them and codes them for the API", () =>
    Effect.sync(() => {
      expect(LawCitation.article("11조의2")).toEqual({ article: 11, branch: 2 })
      expect(LawCitation.article("제3조 제2항")).toEqual({ article: 3, paragraph: 2 })
      expect(LawCitation.article("부칙")).toBeUndefined()
      expect(LawCitation.code({ article: 26, branch: 2 })).toBe("002602")
      expect(LawCitation.code({ article: 11 })).toBe("001100")
    }),
  )
})

describe("LawTools", () => {
  it.live("asks for the key in the settings when there is none, without calling law.go.kr", () =>
    Effect.gen(function* () {
      const { tools, calls } = yield* setup({ key: false })
      const result = yield* tools.search.execute({ query: "보조금" })

      expect(result.output.configured).toBe(false)
      expect(result.content).toContain("설정 → 환경 설정 → 법령 찾기")
      expect(calls).toHaveLength(0)
    }),
  )

  it.live("searches with the user's key and lists what it found", () =>
    Effect.gen(function* () {
      const { tools, calls } = yield* setup()
      const result = yield* tools.search.execute({ query: "산업기술혁신 촉진법" })

      expect(calls[0]?.get("OC")).toBe(KEY)
      expect(calls[0]?.get("type")).toBe("JSON")
      expect(result.output.found.map((item) => item.id)).toEqual(["001461", "003778"])
      expect(result.content).toContain("산업기술혁신 촉진법 (약칭 산업기술혁신법) · id 001461 · 법률 · 산업통상부 · 시행 2026. 9. 18.")
    }),
  )

  it.live("reads an article in its official words by the law's name, and names articles that are not there", () =>
    Effect.gen(function* () {
      const { tools } = yield* setup()
      const result = yield* tools.text.execute({ name: "산업기술혁신촉진법", articles: ["제11조", "99조"] })

      expect(result.output.missing).toEqual(["제99조"])
      expect(result.content).toContain("「산업기술혁신 촉진법」 (법률 · 산업통상부 · 시행 2026. 9. 18.)")
      expect(result.content).toContain("제11조(산업기술개발사업)\n① 산업통상부장관은 기술개발사업을 추진할 수 있다.")
      expect(result.content).toContain("  1. 주관연구기관")
      expect(result.content).toContain("[시행 2026. 9. 18.]")
      expect(result.content).toContain("Not in this text: 제99조")
    }),
  )

  it.live("checks each citation: present, wrong paragraph or item, missing, deleted, unknown law", () =>
    Effect.gen(function* () {
      const { tools } = yield* setup()
      const result = yield* tools.verify.execute({
        text: [
          "「산업기술혁신 촉진법」 제11조 제2항 제1호에 따른 주관연구기관,",
          "같은 법 제11조 제5항, 「산업기술혁신법」 제11조 제2항 제3호와 제99조,",
          "「산업기술혁신 촉진법 시행령」 제4조, 「바이오 진흥 가상법」 제3조.",
        ].join(" "),
      })

      expect(result.output.checks.map((check) => [check.citation, check.result])).toEqual([
        ["「산업기술혁신 촉진법」 제11조 제2항 제1호", "ok"],
        ["「산업기술혁신 촉진법」 제11조 제5항", "missing"],
        ["「산업기술혁신법」 제11조 제2항 제3호", "missing"],
        ["「산업기술혁신법」 제99조", "missing"],
        ["「산업기술혁신 촉진법 시행령」 제4조", "deleted"],
        ["「바이오 진흥 가상법」 제3조", "unknown"],
      ])
      expect(result.output.checks[1]?.note).toBe("제11조에 제5항이 없습니다 (제1항~제2항)")
      expect(result.output.checks[2]?.note).toBe("제11조 제2항에 제3호가 없습니다")
      expect(result.content).toContain("✓ 「산업기술혁신 촉진법」 제11조 제2항 제1호 — 있음: 제11조(산업기술개발사업) [시행 2026. 9. 18.]")
      expect(result.content).toContain("Fix each ✗ and ?")
    }),
  )

  it.live("finds an ordinance's articles and items in text that runs them together", () =>
    Effect.gen(function* () {
      const { tools } = yield* setup()
      const result = yield* tools.verify.execute({ text: `「${ORDINANCE}」 제7조 제3호 및 제4호, 「${ORDINANCE}」 제2조` })

      expect(result.output.checks.map((check) => [check.citation, check.result, check.note])).toEqual([
        [`「${ORDINANCE}」 제7조 제3호`, "ok", "있음: 제7조(육성 사업)"],
        [`「${ORDINANCE}」 제7조 제4호`, "missing", "제7조에 제4호가 없습니다"],
        [`「${ORDINANCE}」 제2조`, "missing", `「${ORDINANCE}」에 없는 조문입니다`],
      ])
      const headings = yield* tools.text.execute({ kind: "ordinance", id: "2035933" })
      expect(headings.content).toContain("제1조(목적)\n제7조(육성 사업)\n")
    }),
  )

  it.live("passes on law.go.kr's own reason when it refuses the key", () =>
    Effect.gen(function* () {
      const { tools } = yield* setup()
      const exit = yield* Effect.exit(tools.search.execute({ query: "보조금", kind: "interpretation" }))

      expect(JSON.stringify(exit)).toContain("법제처: 사용자 정보 검증에 실패하였습니다. 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.")
    }),
  )

  it.live("reports a failed call without the key", () =>
    Effect.gen(function* () {
      const { tools } = yield* setup({ failures: ["prec"] })
      const exit = yield* Effect.exit(tools.search.execute({ query: "부정수급", kind: "precedent" }))

      expect(Exit.isFailure(exit)).toBe(true)
      const message = JSON.stringify(exit)
      expect(message).toContain("법제처(law.go.kr)에 연결하지 못했습니다")
      expect(message).not.toContain(KEY)
    }),
  )
})
