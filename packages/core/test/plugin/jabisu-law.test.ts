import { describe, expect } from "bun:test"
import { deflateRawSync } from "zlib"
import { Effect, Exit } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LawAmendment } from "@opencode/core/plugin/jabisu/law/amendment"
import { LawCases } from "@opencode/core/plugin/jabisu/law/cases"
import { LawCitation } from "@opencode/core/plugin/jabisu/law/citation"
import { LawCompare } from "@opencode/core/plugin/jabisu/law/compare"
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
      return json({
        result: "사용자 정보 검증에 실패하였습니다.",
        msg: "정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
      })
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
      // A sentence quoted whole in 「」 still names the law inside it.
      expect(
        LawCitation.find("「설치 제한지역은 「주차장법」 제12조 제6항에 따라 조례로 정한다.」").map(
          (item) => `${item.name} ${LawCitation.label(item)}`,
        ),
      ).toEqual(["주차장법 제12조 제6항"])
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
      expect(result.content).toContain(
        "산업기술혁신 촉진법 (약칭 산업기술혁신법) · id 001461 · 법률 · 산업통상부 · 시행 2026. 9. 18.",
      )
    }),
  )

  it.live("reads an article in its official words by the law's name, and names articles that are not there", () =>
    Effect.gen(function* () {
      const { tools, calls } = yield* setup()
      const result = yield* tools.text.execute({ name: "산업기술혁신촉진법", articles: ["제11조", "99조"] })

      // The version in force today, not one promulgated to take effect later.
      expect(calls.find((call) => call.get("JO") === "001100")?.get("target")).toBe("eflaw")
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
      expect(result.content).toContain(
        "✓ 「산업기술혁신 촉진법」 제11조 제2항 제1호 — 있음: 제11조(산업기술개발사업) [시행 2026. 9. 18.]",
      )
      expect(result.content).toContain("Fix each ✗, ? and ⚠")
    }),
  )

  it.live("finds an ordinance's articles and items in text that runs them together", () =>
    Effect.gen(function* () {
      const { tools } = yield* setup()
      const result = yield* tools.verify.execute({
        text: `「${ORDINANCE}」 제7조 제3호 및 제4호, 「${ORDINANCE}」 제2조`,
      })

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

      expect(JSON.stringify(exit)).toContain(
        "법제처: 사용자 정보 검증에 실패하였습니다. 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
      )
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

// A fake law.go.kr for what lies beyond a law's text: `answers` maps a target (or the file download) to its answer.
const beyond = (answers: Record<string, (params: URLSearchParams, path: string) => Response>) => {
  const calls: { path: string; params: URLSearchParams }[] = []
  const http = HttpClient.make((request, url) => {
    calls.push({ path: url.pathname, params: url.searchParams })
    const answer = url.pathname.endsWith("flDownload.do")
      ? answers["file"]
      : answers[`${url.pathname.endsWith("lawSearch.do") ? "search" : "text"}:${url.searchParams.get("target")}`]

    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        answer ? answer(url.searchParams, url.pathname) : new Response("", { status: 200 }),
      ),
    )
  })

  return { http, calls }
}

const json = (body: unknown) => new Response(JSON.stringify(body))

const setupBeyond = (answers: Parameters<typeof beyond>[0]) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = { config: (yield* tmpdirScoped()).path }
    const fake = beyond(answers)

    yield* LawSettings.write({ fs, global }, KEY)

    return { tools: LawTools.tools({ fs, global, http: fake.http }), calls: fake.calls }
  })

// A ZIP archive of deflated entries, as Hancom writes an HWPX file.
function zip(entries: Record<string, string>) {
  const records = Object.entries(entries).map(([name, content]) => ({
    name: Buffer.from(name),
    data: deflateRawSync(Buffer.from(content)),
    size: Buffer.byteLength(content),
  }))
  const locals = records.map((entry) => {
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(entry.data.length, 18)
    header.writeUInt32LE(entry.size, 22)
    header.writeUInt16LE(entry.name.length, 26)
    return Buffer.concat([header, entry.name, entry.data])
  })
  const offsets = locals.map((_, index) => locals.slice(0, index).reduce((total, local) => total + local.length, 0))
  const central = Buffer.concat(
    records.map((entry, index) => {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(8, 10)
      header.writeUInt32LE(entry.data.length, 20)
      header.writeUInt32LE(entry.size, 24)
      header.writeUInt16LE(entry.name.length, 28)
      header.writeUInt32LE(offsets[index]!, 42)
      return Buffer.concat([header, entry.name])
    }),
  )
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(records.length, 8)
  end.writeUInt16LE(records.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(
    locals.reduce((total, local) => total + local.length, 0),
    16,
  )
  return Buffer.concat([...locals, central, end])
}

const FORM = zip({
  mimetype: "application/hwp+zip",
  "Contents/section0.xml": `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p><hp:run><hp:t>식품 영업신고사항 변경신고서</hp:t></hp:run></hp:p></hs:sec>`,
})

const ANNEXES = {
  licBylSearch: {
    totalCnt: "3",
    licbyl: [
      {
        별표일련번호: "18443263",
        별표명: "식품 영업신고사항 변경신고서",
        관련법령명: "식품위생법 시행규칙",
        별표종류: "서식",
        별표번호: "004100",
        소관부처명: "식품의약품안전처",
        공포일자: "20260901",
        별표서식파일링크: "/LSW/flDownload.do?flSeq=1",
        별표서식PDF파일링크: "/LSW/flDownload.do?flSeq=2",
      },
      {
        별표일련번호: "18443264",
        별표명: "시설기준",
        관련법령명: "식품위생법 시행규칙",
        별표종류: "별표",
        별표번호: "001402",
        별표서식파일링크: "/LSW/flDownload.do?flSeq=3",
        별표서식PDF파일링크: "/LSW/flDownload.do?flSeq=4",
      },
      {
        별표일련번호: "18443265",
        별표명: "영업 신고증",
        관련법령명: "식품위생법 시행규칙",
        별표종류: "서식",
        별표번호: "003700",
      },
    ],
  },
}

describe("LawTools beyond a law's text", () => {
  it.live("lists a law's annexes by its name and reads one from its Hangul file, else its PDF", () =>
    Effect.gen(function* () {
      const { tools, calls } = yield* setupBeyond({
        "search:licbyl": () => json(ANNEXES),
        // The Hangul file of the form is HWPX; the table's files are a page of words, as law.go.kr sometimes sends.
        file: (params) =>
          params.get("flSeq") === "1" ? new Response(FORM) : new Response("<html>파일을 내려받으세요</html>"),
      })
      const found = yield* tools.search.execute({ kind: "annex", law: "식품위생법 시행규칙", query: "신고서" })

      expect(calls[0]?.params.get("search")).toBe("2")
      expect(calls[0]?.params.get("query")).toBe("식품위생법 시행규칙")
      expect(found.output.found.map((item) => item.id)).toEqual(["18443263"])
      expect(found.content).toContain(
        "식품 영업신고사항 변경신고서 · id 18443263 · 식품위생법 시행규칙 · 별지 제41호서식",
      )

      const form = yield* tools.text.execute({ kind: "annex", id: "18443263" })
      expect(form.content).toContain("한글 파일: https://www.law.go.kr/LSW/flDownload.do?flSeq=1")
      expect(form.content).toContain("PDF: https://www.law.go.kr/LSW/flDownload.do?flSeq=2")
      expect(form.content).toContain("식품 영업신고사항 변경신고서")

      yield* tools.search.execute({ kind: "annex", law: "식품위생법 시행규칙", query: "식품위생법 시행규칙" })
      const table = yield* tools.text.execute({ kind: "annex", id: "18443264" })
      expect(table.content).toContain("「시설기준」 (식품위생법 시행규칙 · 별표 14의2)")
      expect(table.content).toContain("읽을 글자가 없습니다")
      expect(
        calls.filter((call) => call.path.endsWith("flDownload.do")).map((call) => call.params.get("flSeq")),
      ).toEqual(["1", "3", "4"])

      const unknown = yield* Effect.exit(tools.text.execute({ kind: "rule_annex", id: "18443263" }))
      expect(JSON.stringify(unknown)).toContain("Find the rule_annex with law_search first")
    }),
  )

  it.live("searches decisions and reads them by their sections", () =>
    Effect.gen(function* () {
      const { tools, calls } = yield* setupBeyond({
        "search:acr": () =>
          json({
            Acr: {
              totalCnt: "1",
              acr: {
                결정문일련번호: "2147",
                제목: '국고<strong class="tbl_tx_type">보조금</strong> 부가가치세 환수 이의',
                의안번호: "제2024-2소위16-긴01호",
                의결일: "2024.5.27.",
                결정구분: "의 결",
              },
            },
          }),
        "text:acr": () =>
          json({
            AcrService: {
              의결서: {
                제목: "국고보조금 부가가치세 환수 이의",
                주문: "1. 보조금 지침을 보완하라.",
                이유: "1. 신청취지",
                별지: "",
              },
            },
          }),
      })
      const found = yield* tools.search.execute({ kind: "anti_corruption", query: "보조금", text: true })

      expect(calls[0]?.params.get("search")).toBe("2")
      expect(found.content).toContain(
        "국고보조금 부가가치세 환수 이의 · id 2147 · 국민권익위원회 · 제2024-2소위16-긴01호 · 의결 2024. 5. 27. · 의결",
      )
      const decision = yield* tools.text.execute({ kind: "anti_corruption", id: "2147" })
      expect(decision.content).toContain("[주문]\n1. 보조금 지침을 보완하라.\n[이유]\n1. 신청취지")
      expect(decision.content).not.toContain("[별지]")
      expect(decision.content).toContain("name where they come from")
    }),
  )

  it.live("says when the key has not applied for a kind, and when a record is not there", () =>
    Effect.gen(function* () {
      const { tools } = yield* setupBeyond({
        "search:trty": () => new Response("<html><body>미신청된 목록/본문에 대한 접근입니다.</body></html>"),
      })
      const refused = yield* Effect.exit(tools.search.execute({ kind: "treaty", query: "보조금" }))
      expect(JSON.stringify(refused)).toContain("이 인증키로 신청하지 않은 자료입니다")

      const missing = yield* Effect.exit(tools.text.execute({ kind: "constitutional", id: "1" }))
      expect(JSON.stringify(missing)).toContain("법제처에 그 자료가 없습니다")
    }),
  )

  it.live("reads one term from each dictionary it is in", () =>
    Effect.gen(function* () {
      const { tools, calls } = yield* setupBeyond({
        "text:lstrm": () =>
          json({
            LsTrmService: {
              법령용어명_한글: ["간접보조금", "간접보조금"],
              법령용어코드명: ["법령정의사전", "법령한영사전"],
              법령용어정의: ["다시 교부하는 급부금을 말한다.", "indirect subsidies"],
            },
          }),
      })
      const term = yield* tools.text.execute({ kind: "term", id: "13556,4926796" })

      expect(calls[0]?.params.get("trmSeqs")).toBe("13556,4926796")
      expect(term.content).toContain("「간접보조금」")
      expect(term.content).toContain(
        "[법령정의사전 정의]\n다시 교부하는 급부금을 말한다.\n[법령한영사전 정의]\nindirect subsidies",
      )
    }),
  )

  it.live("compares the latest amendment by article, leaving out the lines it keeps only for place", () =>
    Effect.gen(function* () {
      const info = (number: string, effective: string) => ({
        법령명: "건강기능식품에 관한 법률",
        법종구분: "법률",
        공포번호: number,
        공포일자: "20260407",
        시행일자: effective,
        제개정구분명: "일부개정",
      })
      const { tools } = yield* setupBeyond({
        "text:oldAndNew": () =>
          json({
            OldAndNewService: {
              구조문_기본정보: info("21298", "20251230"),
              신조문_기본정보: info("21525", "20261008"),
              구조문목록: {
                조문: [
                  { no: "1", content: "제9조(영업허가 등의 제한) ① 다음 각 호의 경우에는 허가를 할 수 없다." },
                  { no: "2", content: "1.·2. (생 략)" },
                  { no: "3", content: "3. 파산선고를 받은 자인 경우" },
                  { no: "4", content: "제32조(영업허가취소 등) ① 다음과 같다." },
                  { no: "5", content: "9의2. 파산선고를 받은 경우" },
                ],
              },
              신조문목록: {
                조문: [
                  { no: "1", content: "제9조(영업허가 등의 제한) ① 다음 각 호의 경우에는 허가를 할 수 없다." },
                  { no: "2", content: "1.·2. (현행과 같음)" },
                  { no: "3", content: "3. 피성년후견인인 경우" },
                  { no: "4", content: "제32조(영업허가취소 등) ① 다음과 같다." },
                  { no: "5", content: "9의2. 피성년후견인이 된 경우" },
                ],
              },
            },
          }),
      })
      const result = yield* tools.compare.execute({ mode: "changes", id: "009353" })

      expect(result.content).toContain("개정 후: 법률 제21525호 · 공포 2026. 4. 7. · 시행 2026. 10. 8. · 일부개정")
      expect(result.content).toContain(
        "[제9조(영업허가 등의 제한)]\n개정 전: 3. 파산선고를 받은 자인 경우\n개정 후: 3. 피성년후견인인 경우\n\n[제32조(영업허가취소 등)]",
      )
      expect(result.content).not.toContain("(생 략)")
    }),
  )

  it.live("shows the decree and rule articles that carry out a law's articles, and what is made under it", () =>
    Effect.gen(function* () {
      const { tools } = yield* setupBeyond({
        "text:thdCmp": (params) => {
          expect(params.get("knd")).toBe("1")
          return json({
            ThdCmpLawXService: {
              기본정보: { 법령명: "건강기능식품에 관한 법률", 시행령명: "건강기능식품에 관한 법률 시행령" },
              인용조문삼단비교: {
                법률조문: [
                  { 조번호: "0001", 조가지번호: "00", 조제목: "", 조내용: "제1장 총칙" },
                  { 조번호: "0001", 조가지번호: "00", 조제목: "제1조(목적)", 조내용: "이 법은 목적으로 한다." },
                  {
                    조번호: "0004",
                    조가지번호: "00",
                    조제목: "제4조(영업의 종류)",
                    조내용: "② 세부 종류는 대통령령으로 정한다.",
                    시행령조문목록: {
                      시행령조문: { 조제목: "제2조(영업의 종류)", 조내용: "법 제4조제2항에 따른 영업은 다음과 같다." },
                    },
                    시행규칙조문목록: {
                      시행규칙조문: [
                        { 조제목: "제2조(시설기준)", 조내용: "시설기준은 별표 1과 같다." },
                        { 조제목: "제3조(신청)", 조내용: "신청서를 낸다." },
                      ],
                    },
                  },
                ],
              },
            },
          })
        },
        "text:lsStmd": () =>
          json({
            법령체계도: {
              기본정보: { 법령명: "건강기능식품에 관한 법률", 법종구분: "법률", 시행일자: "20261008" },
              상하위법: {
                법률: {
                  기본정보: { 법령ID: "009353", 법령명: "건강기능식품에 관한 법률" },
                  시행령: {
                    기본정보: { 법령ID: "009581", 법령명: "건강기능식품에 관한 법률 시행령", 법종구분: "대통령령" },
                    행정규칙: {
                      고시: [
                        {
                          기본정보: {
                            행정규칙일련번호: "2100000258002",
                            행정규칙명: "신고포상금 지급에 관한 규정",
                            법종구분: "고시",
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          }),
      })
      const headings = yield* tools.compare.execute({ mode: "delegation", id: "009353" })

      expect(headings.content).toContain(
        "제4조(영업의 종류) → 시행령 제2조(영업의 종류) · 시행규칙 제2조(시설기준) · 시행규칙 제3조(신청)",
      )
      expect(headings.content).toContain("1 other articles have none.")

      const full = yield* tools.compare.execute({ mode: "delegation", id: "009353", articles: ["제4조", "제7조"] })
      expect(full.output.missing).toEqual(["제7조"])
      expect(full.content).toContain("  [시행령] 제2조(영업의 종류) 법 제4조제2항에 따른 영업은 다음과 같다.")

      const system = yield* tools.compare.execute({ mode: "system", id: "009353" })
      expect(system.content).toContain("- 법률 > 시행령: 건강기능식품에 관한 법률 시행령 (대통령령) · law id 009581")
      expect(system.content).toContain(
        "- 법률 > 시행령 > 행정규칙 > 고시: 신고포상금 지급에 관한 규정 (고시) · rule id 2100000258002",
      )
      expect(system.content).not.toContain("- 법률: ")
    }),
  )

  it.live("lists a law's versions and reads its articles as in force on a date", () =>
    Effect.gen(function* () {
      const row = (mst: string, number: string, promulgated: string, effective: string, change = "일부개정") => ({
        법령ID: "009353",
        법령일련번호: mst,
        법령명한글: "건강기능식품에 관한 법률",
        법령구분명: "법률",
        공포번호: number,
        공포일자: promulgated,
        시행일자: effective,
        제개정구분명: change,
        현행연혁코드: "연혁",
      })
      const { tools, calls } = yield* setupBeyond({
        "search:eflaw": () =>
          json({
            LawSearch: {
              totalCnt: "4",
              law: [
                row("234347", "18359", "20210727", "20210727"),
                row("259283", "20138", "20240123", "20240724"),
                { ...row("1", "1", "20000101", "20000101"), 법령ID: "000001" },
                row("234853", "18445", "20210817", "20230101", "타법개정"),
              ],
            },
          }),
        "text:eflaw": () =>
          json({
            법령: {
              기본정보: { 법령명_한글: "건강기능식품에 관한 법률", 시행일자: "20230101" },
              조문: { 조문단위: { 조문번호: "9", 조문내용: "제9조(영업허가 등의 제한)", 조문여부: "조문" } },
            },
          }),
      })
      const history = yield* tools.compare.execute({ mode: "history", id: "009353" })

      expect(calls[0]?.params.get("LID")).toBe("009353")
      expect(history.content).toContain("「건강기능식품에 관한 법률」 연혁 (3개 시행본, 새것부터)")
      expect(history.content).toContain(
        "- 시행 2024. 7. 24. · 법률 제20138호 · 공포 2024. 1. 23. · 일부개정\n- 시행 2023. 1. 1. · 법률 제18445호",
      )

      const past = yield* tools.compare.execute({
        mode: "as_of",
        id: "009353",
        date: "2024. 1. 1.",
        articles: ["제9조"],
      })
      const read = calls.at(-1)!.params
      expect([read.get("MST"), read.get("efYd"), read.get("JO")]).toEqual(["234853", "20230101", "000900"])
      expect(past.content).toContain("2024. 1. 1.에 시행 중이던 판: 시행 2023. 1. 1. · 법률 제18445호")
      expect(past.content).toContain("제9조(영업허가 등의 제한)")

      const early = yield* Effect.exit(tools.compare.execute({ mode: "as_of", id: "009353", date: "2020-01-01" }))
      expect(JSON.stringify(early)).toContain("아직 시행되지 않았습니다 (처음 시행 2021. 7. 27.)")
    }),
  )
})

describe("LawTools for more bodies, cases, ordinances and amendments", () => {
  it.live("searches and reads more appeal bodies, a ministry's interpretations and a public body's rules", () =>
    Effect.gen(function* () {
      const { tools } = yield* setupBeyond({
        "search:iaciac": () =>
          json({
            Iaciac: {
              totalCnt: "1",
              iaciac: { 결정문일련번호: "12699", 사건: "2010재결 제2071호 요양불승인처분취소", 의결일자: "2010.08.27" },
            },
          }),
        "text:eiac": () =>
          json({
            EiacService: {
              사건명: "실업급여 과오급 반환 결정 처분 취소청구",
              사건번호: "2023재결 제9호",
              의결일자: "2023.3.15",
              기관명: "고용보험심사위원회",
              주문: '<span style="display:none;">주 문</span>청구인의 청구를 기각한다.',
              이유: "청구인 ○○○(이하 &#39;청구인’이라 한다)은 해고되었다<각주>1</각주>.",
              각주목록: { 각주번호: "1", 각주내용: "중대한 귀책사유가 있는 경우" },
            },
          }),
        "text:adapSpecialDecc": () =>
          json({
            SpecialDeccService: {
              사건명: "감봉1월 처분 취소 청구",
              재결청: "인사혁신처 소청심사위원회",
              사건번호: "2021-690",
              의결일자: "",
              대분류: "징계처분",
              중분류: "금품·향응수수",
              원처분: "감봉1월",
              결정유형: "기각",
              소청사례명: "골프회동 후 향응수수",
              주문: "이 청구를 기각한다.",
            },
          }),
        "search:moelCgmExpc": () =>
          json({
            CgmExpc: {
              totalCnt: "1",
              cgmExpc: {
                법령해석일련번호: "15234",
                안건명: "연차유급휴가 사용촉진의 대상 여부",
                안건번호: "근로기준정책과-3084",
                해석기관명: "고용노동부",
                해석일자: "2015.07.13",
              },
            },
          }),
        "text:pi": () =>
          json({
            AdmRulService: {
              행정규칙기본정보: {
                행정규칙명: "(건강보험심사평가원) 인사규정",
                행정규칙종류: "공단규정",
                시행일자: "20260301",
              },
              조문내용: ["제1조(목적) 이 규정은 인사에 관하여 정한다.", "제2조(적용) 이 규정은 직원에게 적용한다."],
            },
          }),
      })
      const insurance = yield* tools.search.execute({ kind: "accident_insurance", query: "요양" })
      expect(insurance.content).toContain(
        "2010재결 제2071호 요양불승인처분취소 · id 12699 · 산업재해보상보험재심사위원회 · 의결 2010. 8. 27.",
      )

      const employment = yield* tools.text.execute({ kind: "employment_insurance", id: "12697" })
      expect(employment.content).toContain("[주문]\n청구인의 청구를 기각한다.")
      expect(employment.content).toContain("(이하 '청구인’이라 한다)은 해고되었다[각주1].")
      expect(employment.content).toContain("[각주]\n[각주1] 중대한 귀책사유가 있는 경우")

      const appeal = yield* tools.text.execute({ kind: "civil_service", id: "2071809" })
      expect(appeal.content).toContain(
        "(인사혁신처 소청심사위원회 · 2021-690 · 징계처분 > 금품·향응수수 · 원처분 감봉1월 · 결정 기각)",
      )
      expect(appeal.content).toContain("[소청사례명]\n골프회동 후 향응수수")

      const answer = yield* tools.search.execute({ kind: "labor_ministry", query: "연차" })
      expect(answer.content).toContain("고용노동부 회신 2015. 7. 13. · 안건번호 근로기준정책과-3084")

      const rule = yield* tools.text.execute({ kind: "public_institution", id: "2200000152361", articles: ["제2조"] })
      expect(rule.content).toContain("제2조(적용) 이 규정은 직원에게 적용한다.")
      expect(rule.content).not.toContain("제1조(목적)")
    }),
  )

  it.live("checks cited cases: on record, not on record, impossible, and changed by a later en banc judgment", () =>
    Effect.gen(function* () {
      const precedent = (number: string, serial: string, day: string, type: string, court = "대법원") => ({
        판례일련번호: serial,
        사건번호: number,
        법원명: court,
        선고일자: day,
        판결유형: type,
        사건명: "손해배상(기)",
      })
      const { tools, calls } = yield* setupBeyond({
        "search:prec": (params) => {
          const nb = params.get("nb")
          const query = params.get("query")

          // law.go.kr matches the start of a number, so a number cut short finds the longer one.
          if (nb === "2013다61381" || nb === "2013다6138")
            return json({
              PrecSearch: { totalCnt: "1", prec: precedent("2013다61381", "204201", "2018.10.30", "전원합의체 판결") },
            })
          if (nb === "2010다1234")
            return json({ PrecSearch: { totalCnt: "1", prec: precedent("2010다1234", "1", "2010.01.01", "판결") } })
          if (query === "2010다1234")
            return json({
              PrecSearch: {
                totalCnt: "2",
                prec: [
                  precedent("2020다5555", "2", "2022.02.02", "전원합의체 판결"),
                  precedent("2015다7777", "3", "2016.01.01", "판결"),
                ],
              },
            })

          return json({ PrecSearch: { totalCnt: "0" } })
        },
        "text:prec": () =>
          json({
            PrecService: {
              판례내용:
                "나. 이와 달리 본 대법원 2010. 1. 1. 선고 2010다1234 판결은 이 판결의 견해에 배치되는 범위에서 이를 변경하기로 한다.",
            },
          }),
        "search:detc": () =>
          json({
            DetcSearch: {
              totalCnt: "2",
              Detc: [
                { 사건번호: "2020헌바123", 종국일자: "2020.03.10", 사건명: "민법 제397조 제1항 등 위헌소원" },
                { 사건번호: "2020헌마1343", 종국일자: "2024.02.28", 사건명: "주택임대차보호법 위헌확인" },
              ],
            },
          }),
      })
      const result = yield* tools.verify.execute({
        text: "대법원 2018. 10. 30. 선고 2013다61381 전원합의체 판결, 2013다6138, 대법원 2010다1234 판결, 헌법재판소 2020헌바123 결정, 2099다1 판결. 2030도 3000명이 늘었다.",
      })

      expect(result.output.checks.map((check) => [check.citation, check.result])).toEqual([
        ["2013다61381", "ok"],
        ["2013다6138", "unknown"],
        ["2010다1234", "changed"],
        ["2020헌바123", "ok"],
        ["2099다1", "missing"],
      ])
      expect(result.output.checks[0]?.note).toBe(
        "있음: 대법원 2018. 10. 30. 2013다61381 전원합의체 판결 (손해배상(기))",
      )
      expect(result.output.checks[2]?.note).toContain(
        "2022. 2. 2. 2020다5555 전원합의체 판결이 이 판결을 변경한 것으로 보입니다",
      )
      expect(result.output.checks[3]?.note).toBe("있음: 헌법재판소 2020. 3. 10. 민법 제397조 제1항 등 위헌소원")
      expect(result.content).toContain("⚠ 2010다1234")
      // Only the later en banc judgment is read, not every one that cites the case.
      expect(calls.filter((call) => call.path.endsWith("lawService.do")).map((call) => call.params.get("ID"))).toEqual([
        "2",
      ])

      // A case searched for by its number is found by the number, not by the judgments citing it.
      const byNumber = yield* tools.search.execute({ kind: "precedent", query: "대법원 2010다1234 판결" })
      expect(calls.at(-1)?.params.get("nb")).toBe("2010다1234")
      expect(calls.at(-1)?.params.get("query")).toBeNull()
      expect(byNumber.output.found.map((item) => item.id)).toEqual(["1"])
    }),
  )

  it.live("reports a cited paragraph or item kept only as 삭제 as deleted", () =>
    Effect.gen(function* () {
      const { tools } = yield* setupBeyond({
        "search:law": () =>
          json({
            LawSearch: { totalCnt: "1", law: { 법령ID: "001814", 법령명한글: "주차장법", 현행연혁코드: "현행" } },
          }),
        "text:eflaw": () =>
          json({
            법령: {
              기본정보: { 법령명_한글: "주차장법", 시행일자: "20260828" },
              조문: {
                조문단위: {
                  조문여부: "조문",
                  조문번호: "12",
                  조문내용: "제12조(노외주차장의 설치 등)",
                  항: [
                    {
                      항번호: "①",
                      항내용: "① 노외주차장을 설치한 자는 다음 사항을 통보하여야 한다.",
                      호: [
                        { 호번호: "1.", 호내용: "1. 삭제 <2020.1.1>" },
                        { 호번호: "2.", 호내용: "2. 설치 장소" },
                      ],
                    },
                    { 항번호: "⑥", 항내용: "⑥ 삭제 <2026.2.27>" },
                  ],
                },
              },
            },
          }),
      })
      const result = yield* tools.verify.execute({
        text: "「주차장법」 제12조 제6항, 「주차장법」 제12조 제1항 제1호, 「주차장법」 제12조 제1항 제2호",
      })

      expect(result.output.checks.map((check) => [check.citation, check.result, check.note])).toEqual([
        ["「주차장법」 제12조 제6항", "deleted", "제12조 제6항은(는) 삭제되었습니다"],
        ["「주차장법」 제12조 제1항 제1호", "deleted", "제12조 제1항 제1호은(는) 삭제되었습니다"],
        ["「주차장법」 제12조 제1항 제2호", "ok", "있음: 제12조(노외주차장의 설치 등)"],
      ])
    }),
  )

  it.live("checks an ordinance against the laws its purpose article names", () =>
    Effect.gen(function* () {
      const version = (id: string, name: string, effective: string, number: string) => ({
        법령ID: id,
        법령일련번호: `${id}-${effective}`,
        법령명한글: name,
        법령구분명: "법률",
        공포번호: number,
        공포일자: effective,
        시행일자: effective,
        제개정구분명: "일부개정",
      })
      const { tools } = yield* setupBeyond({
        "text:ordin": () =>
          json({
            LawService: {
              자치법규기본정보: {
                자치법규명: "서울특별시 광진구 주차장 설치 및 관리 조례",
                시행일자: "20240101",
                지자체기관명: "서울특별시 광진구",
                담당부서명: "주차관리팀",
              },
              조문: {
                조: [
                  { 조제목: "", 조내용: "제1장 총칙", 조문여부: "N" },
                  {
                    조제목: "목적",
                    조내용:
                      "제1조(목적) 이 조례는 「주차장법」, 같은 법 시행령 및 시행규칙에서 위임한 사항과 「광진구 다른 조례」에 따른 사항을 규정한다.",
                    조문여부: "Y",
                  },
                  { 조제목: "감면", 조내용: "제9조(감면) 「공직선거법」에 따른 선거사무소는 감면한다.", 조문여부: "Y" },
                ],
              },
            },
          }),
        "search:law": (params) => {
          const law = { 주차장법: "001", "주차장법 시행령": "002" }[params.get("query") ?? ""]

          return json({
            LawSearch: law
              ? { totalCnt: "1", law: { 법령ID: law, 법령명한글: params.get("query"), 현행연혁코드: "현행" } }
              : { totalCnt: "0" },
          })
        },
        "search:eflaw": (params) =>
          json({
            LawSearch:
              params.get("LID") === "001"
                ? {
                    totalCnt: "3",
                    law: [
                      version("001", "주차장법", "20230101", "100"),
                      version("001", "주차장법", "20250301", "200"),
                      version("001", "주차장법", "20990101", "300"),
                    ],
                  }
                : { totalCnt: "1", law: version("002", "주차장법 시행령", "20230601", "50") },
          }),
      })
      const result = yield* tools.compare.execute({ mode: "ordinance", id: "2112919" })

      expect(result.content).toContain(
        "「서울특별시 광진구 주차장 설치 및 관리 조례」 정비 점검 (서울특별시 광진구 · 주차관리팀 · 시행 2024. 1. 1.)",
      )
      expect(result.content).toContain("「주차장법」 (id 001): 조례 시행 뒤 시행된 개정 1건, 시행 예정 1건")
      expect(result.content).toContain("  · 시행 2025. 3. 1. · 법률 제200호 · 공포 2025. 3. 1. · 일부개정")
      expect(result.content).toContain("  · 시행 2099. 1. 1. · 법률 제300호 · 공포 2099. 1. 1. · 일부개정 (시행 예정)")
      expect(result.content).toContain(
        "「주차장법 시행령」 (id 002): 조례 시행 뒤 시행된 개정 없음 (현행 시행 2023. 6. 1.)",
      )
      expect(result.content).toContain("「주차장법 시행규칙」: 법령에서 찾지 못했습니다")
      expect(result.content).not.toContain("공직선거법")
      expect(result.content).not.toContain("「광진구 다른 조례」:")
    }),
  )

  it.live("makes the comparison table of an amendment from the current articles and saves it as a Hangul file", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = { config: (yield* tmpdirScoped()).path }
      const fake = beyond({
        "search:law": () =>
          json({ LawSearch: { totalCnt: "1", law: { 법령ID: "001823", 법령명한글: "건축법", 현행연혁코드: "현행" } } }),
        "text:eflaw": (params) =>
          json({
            법령: {
              기본정보: { 법령명_한글: "건축법", 법종구분: "법률", 시행일자: "20260101" },
              ...(params.get("JO") === "002200"
                ? {
                    조문: {
                      조문단위: {
                        조문여부: "조문",
                        조문번호: "22",
                        조문내용: "제22조(건축물의 사용승인)",
                        항: [
                          { 항번호: "①", 항내용: "① 건축주는 사용승인을 신청하여야 한다. <개정 2013.3.23>" },
                          {
                            항번호: "②",
                            항내용: "② 허가권자는 다음 각 호의 검사를 한다.",
                            호: [
                              { 호번호: "1.", 호내용: "1. 설계도서대로 시공되었는지의 여부" },
                              { 호번호: "2.", 호내용: "2. 감리완료보고서 등의 서류가 적합한지의 여부" },
                            ],
                          },
                          { 항번호: "③", 항내용: "③ 건축주는 사용승인을 받은 후가 아니면 건축물을 사용할 수 없다." },
                        ],
                      },
                    },
                  }
                : {}),
            },
          }),
      })
      const saved: { file: string; bytes: Uint8Array }[] = []
      const save: LawTools.Save = (file, bytes) =>
        Effect.sync(() => {
          saved.push({ file, bytes })
          return file
        })

      yield* LawSettings.write({ fs, global }, KEY)
      const tools = LawTools.tools({ fs, global, http: fake.http, save })
      const context = {
        sessionID: "s",
        agent: "build",
        messageID: "m",
        id: "t",
      } as unknown as Parameters<LawTools.Save>[2]
      const result = yield* tools.amend.execute(
        {
          name: "건축법",
          amendments: [
            { text: "제22조의2(사용승인의 공개) 허가권자는 사용승인 현황을 공개하여야 한다." },
            {
              text: [
                "제22조(건축물의 사용승인) ① (현행과 같음)",
                "② 허가권자는 다음 각 호의 검사를 한다.",
                "1. (현행과 같음)",
                "2. 감리완료보고서, 에너지절약계획서 등의 서류가 적합한지의 여부",
                "3. 에너지 절약계획의 이행 여부",
                "③ 건축주는 사용승인을 받은 후가 아니면 건축물을 사용할 수 없다. 다만, 대통령령으로 정하는 경우에는 그러하지 아니하다.",
              ].join("\n"),
            },
          ],
          file: "대비표.hwpx",
        },
        context,
      )

      expect(result.output.title).toBe("건축법 일부개정법률안")
      expect(result.content).toContain("### 건축법 일부개정법률안 신·구조문대비표")
      expect(result.content).toContain(
        "| 제22조(건축물의 사용승인) ① (생  략) | 제22조(건축물의 사용승인) ① (현행과 같음) |",
      )
      expect(result.content).toContain("| 1. (생  략) | 1. (현행과 같음) |")
      expect(result.content).toContain(
        `| 2. **감리완료보고서** 등의 서류가 적합한지의 여부 | 2. **감리완료보고서, 에너지절약계획서** ${"-".repeat(15)} |`,
      )
      expect(result.content).toContain("| **<신  설>** | **3. 에너지 절약계획의 이행 여부** |")
      expect(result.content).toContain("사용할 수 없다. **<단서 신설>** |")
      expect(result.content).toContain("**다만, 대통령령으로 정하는 경우에는 그러하지 아니하다.** |")
      // Articles come in order, the new one last.
      expect(result.content.indexOf("제22조의2")).toBeGreaterThan(result.content.indexOf("제22조(건축물의 사용승인)"))
      expect(result.output.notes).toContain("제22조의2: 현행에 없는 조라 신설로 적었습니다. 번호가 맞는지 확인하세요")
      expect(result.output.file).toBe("대비표.hwpx")
      const document = new TextDecoder().decode(saved[0]!.bytes)
      expect(saved[0]!.file).toBe("대비표.hwpx")
      expect(document.startsWith("PK")).toBe(true)
      expect(document).toContain("mimetypeapplication/hwp+zip")
      expect(document).toContain("<hp:t>건축법 일부개정법률안</hp:t>")
      expect(document).toContain('<hh:underline type="BOTTOM"')
      expect(document).toContain('repeatHeader="1" rowCnt="8" colCnt="2"')

      const wrong = yield* Effect.exit(
        tools.amend.execute({ name: "건축법", amendments: [{ text: "허가권자는 공개한다." }] }, context),
      )
      expect(JSON.stringify(wrong)).toContain("Start each amendment's text with its article")
    }),
  )

  it.live("compares a draft with the current text it is given, without law.go.kr", () =>
    Effect.gen(function* () {
      const { tools, calls } = yield* setupBeyond({})
      const result = yield* tools.amend.execute({
        kind: "ordinance",
        name: "광진구 주차장 조례",
        amendments: [
          {
            current: "제5조(목적) ① 이 조례는 주차장을 정한다.\n② 구청장은 계획을 세운다.\n③ 계획은 공고한다.",
            text: "제5조(목적) ① (현행과 같음)\n② 삭제",
          },
          { current: "제7조(벌칙) 1천만원 이하의 벌금에 처한다.", text: "제7조(과태료) 1천만원 이하의 벌금에 처한다." },
          { current: "제9조(위임) 구청장이 정한다.", text: "제9조 삭제" },
        ],
      })

      expect(calls).toEqual([])
      expect(result.output.title).toBe("광진구 주차장 조례 일부개정조례안")
      expect(result.content).toContain("| 제5조(목적) ① (생  략) | 제5조(목적) ① (현행과 같음) |")
      expect(result.content).toContain("| **② 구청장은 계획을 세운다.** | ② **삭제** |")
      expect(result.content).toContain("| **③ 계획은 공고한다.** | **<삭  제>** |")
      expect(result.content).toContain("| 제7조(**벌칙**) (생  략) | 제7조(**과태료**) (현행과 같음) |")
      expect(result.content).toContain("| **제9조(위임) 구청장이 정한다.** | 제9조 **삭제** |")
      expect(result.output.notes).toContain(
        '제5조: 개정안에 없는 ③을(를) <삭  제>로 적었습니다. 그대로 두는 것이면 개정안에 "② ∼ ⑤ (현행과 같음)"처럼 적으세요',
      )
    }),
  )
})

describe("LawAmendment, LawCases and LawCompare", () => {
  it.live("finds case numbers apart from articles and amounts, and the laws an ordinance carries out", () =>
    Effect.sync(() => {
      expect(
        LawCases.find("대법원 2013다61381, 96누4671 판결과 2024헌바107, 2030도 3000명, 제999조의9, 2013다61381"),
      ).toEqual(["2013다61381", "96누4671", "2024헌바107"])
      expect(
        LawCompare.basis("이 조례는 「주차장법」, 같은 법 시행령 및 시행규칙에서 위임한 사항을 정한다.", "주차장 조례"),
      ).toEqual(["주차장법", "주차장법 시행령", "주차장법 시행규칙"])
      expect(LawAmendment.dashes("이 법은 공포한 날부터 시행한다.")).toBe(`${"-".repeat(17)}.`)
    }),
  )
})
