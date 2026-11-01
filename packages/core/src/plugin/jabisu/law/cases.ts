export * as LawCases from "./cases.js"

import { Effect } from "effect"
import { LawApi } from "./api.js"

// Court and Constitutional Court cases cited by their numbers, as 대법원 2018. 10. 30. 선고 2013다61381 판결 cites one:
// whether law.go.kr has the case, and whether a later en banc judgment that cites it says it changed or overruled it.
// law.go.kr keeps mostly Supreme Court cases, so a case it does not have is unknown, not missing; only a year still to
// come proves a number false.

const { clean, parse, record, records, str } = LawApi

// The case-type codes courts give (법원 사건별 부호), longest first so that 재고합 is not read as 재.
const CODES = [
  ...[
    "가소",
    "가단",
    "가합",
    "가",
    "나",
    "다카",
    "다",
    "머",
    "자",
    "차전",
    "차",
    "카단",
    "카합",
    "카기",
    "카명",
    "카확",
  ],
  ...["카", "그", "마", "라", "바", "사", "아", "타", "하단", "하합", "하"],
  ...["고단", "고합", "고정", "고약", "고", "노", "도", "오", "초", "감", "전", "보", "모", "로", "코"],
  ...["구단", "구합", "구", "누", "두", "루", "부", "수", "우", "주"],
  ...["드단", "드합", "드", "르", "므", "브", "스", "너", "버", "즈단", "즈합", "즈", "느단", "느합", "느"],
  ...["허", "후", "취"],
  ...["헌가", "헌나", "헌다", "헌라", "헌마", "헌바", "헌사", "헌아"],
  ...["회단", "회합", "회확", "회기", "회", "개회", "개확", "간회", "간확", "파"],
  ...["재고합", "재나", "재다", "재두", "재누", "재"],
].sort((a, b) => b.length - a.length)

// A year, a code and a serial number, apart from 제999조의9 and from amounts such as 2030도 3000명: what follows a case
// number is never a counting word.
const NUMBER = new RegExp(
  `(?<![\\d제])((?:19|20)\\d{2}|\\d{2}) ?(${CODES.join("|")}) ?(\\d{1,8})(?![\\d명개원건회차호년월일조항목억천])`,
  "g",
)

/** The case numbers cited in a text, each once, as courts write them: 2013다61381. */
export function find(text: string) {
  return [
    ...new Set([...text.replace(/\s+/g, " ").matchAll(NUMBER)].map((match) => `${match[1]}${match[2]}${match[3]}`)),
  ]
}

const isConstitutional = (number: string) => /^\d+헌/.test(number)

/** Whether a field that can list several numbers, as 2017다360, 2017다377 does, has this one. */
const lists = (field: string, number: string) =>
  field
    .replace(/\s/g, "")
    .split(/[,·;/]/)
    .includes(number)

export interface Case {
  readonly number: string
  readonly result: "ok" | "missing" | "unknown" | "changed"
  readonly note: string
}

// A judgment changes a precedent in set words: 변경하기로 한다, 폐기한다, 이와 배치되는 범위에서 변경한다.
const CHANGE = [
  /변경하기로\s*(?:한다|하면서|함|하였)/,
  /폐기하기로|폐기한다|폐기되었/,
  /더\s*이상\s*유지(?:될\s*수\s*없|하기\s*어렵)/,
  /배치되는\s*범위\s*에?서?\s*(?:이를\s*)?(?:모두\s*)?변경/,
]

/**
 * Whether a judgment says, near where it names the case, that it changes it: within a few sentences of the number or
 * of the short name it gives the case, as (이하 '2008년 전원합의체 판결'이라 한다) does.
 */
export function changes(judgment: string, number: string) {
  const text = clean(judgment).replace(/\s+/g, " ")
  const spaced = number.replace(/^(\d+)(\D+)(\d+)$/, "$1\\s*$2\\s*$3")
  const places = [...text.matchAll(new RegExp(`(?<!\\d)${spaced}(?!\\d)`, "g"))].map((match) => match.index)
  const named = new RegExp(
    `(?<!\\d)${spaced}(?!\\d)[^(]{0,40}\\(\\s*이하\\s*[‘'"“]?([^’'"”)]{2,40}?)[’'"”]?\\s*(?:이?라\\s*고?\\s*)?한다`,
    "g",
  )

  for (const match of text.matchAll(named))
    for (const use of text.matchAll(new RegExp(match[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")))
      places.push(use.index)
  // The words that change it are quoted with a little around them, cut at word boundaries.
  for (const at of places) {
    const start = Math.max(0, at - 250)

    for (const pattern of CHANGE) {
      const found = pattern.exec(text.slice(start, at + 250))

      if (!found) continue
      const middle = start + found.index + found[0].length / 2

      return text
        .slice(Math.max(0, middle - 90), middle + 90)
        .replace(/^\S*\s/, "…")
        .replace(/\s\S*$/, "…")
    }
  }

  return undefined
}

/** The precedents law.go.kr lists for a search, as their raw fields. */
const precedents = (call: LawApi.Transport, params: Record<string, string>) =>
  call("lawSearch.do", { target: "prec", ...params }).pipe(
    Effect.flatMap(parse),
    Effect.map((root) => records(record(record(root)?.["PrecSearch"])?.["prec"])),
  )

const day = (value: unknown) => str(value).replace(/\D/g, "")

// Of the later en banc judgments that cite a case, the newest are read; one that changed it is nearly always among them.
const MAX_READ = 2

/** One cited case: whether law.go.kr has it, and for a Supreme Court case whether a later en banc judgment changed it. */
export const check = Effect.fn("LawCases.check")(function* (call: LawApi.Transport, number: string, year: number) {
  const cited = /^(\d{4})/.exec(number)?.[1]

  if (cited && Number(cited) > year)
    return { number, result: "missing", note: "사건 연도가 아직 오지 않아 있을 수 없는 사건번호입니다" } satisfies Case
  if (isConstitutional(number)) {
    const root = yield* parse(yield* call("lawSearch.do", { target: "detc", nb: number, display: "20" }))
    const hit = records(record(record(root)?.["DetcSearch"])?.["Detc"]).find((item) =>
      lists(str(item["사건번호"]), number),
    )

    return hit
      ? ({
          number,
          result: "ok",
          note: `있음: 헌법재판소 ${LawApi.date(str(hit["종국일자"]))} ${clean(str(hit["사건명"]))}`,
        } satisfies Case)
      : ({ number, result: "unknown", note: "법제처에서 찾지 못했습니다. 번호를 확인하세요" } satisfies Case)
  }
  const hit = (yield* precedents(call, { nb: number, display: "20" })).find((item) =>
    lists(str(item["사건번호"]), number),
  )

  if (!hit)
    return {
      number,
      result: "unknown",
      note: "법제처 판례에서 찾지 못했습니다. 하급심이거나 실리지 않은 판결일 수 있어 없다고 단정할 수 없습니다",
    } satisfies Case
  const found = `있음: ${str(hit["법원명"])} ${LawApi.date(str(hit["선고일자"]))} ${str(hit["사건번호"])} ${str(hit["판결유형"])} (${clean(str(hit["사건명"]))})`

  if (str(hit["법원명"]) !== "대법원") return { number, result: "ok", note: found } satisfies Case
  const later = (yield* precedents(call, { search: "2", query: number, display: "50" })).filter(
    (item) =>
      str(item["판결유형"]).includes("전원합의체") &&
      !lists(str(item["사건번호"]), number) &&
      day(item["선고일자"]) > day(hit["선고일자"]),
  )

  for (const item of later.sort((a, b) => day(b["선고일자"]).localeCompare(day(a["선고일자"]))).slice(0, MAX_READ)) {
    const root = record(yield* parse(yield* call("lawService.do", { target: "prec", ID: str(item["판례일련번호"]) })))
    const near = changes(str(record(root?.["PrecService"])?.["판례내용"]), number)

    if (near)
      return {
        number,
        result: "changed",
        note: `${found}. 그러나 ${LawApi.date(str(item["선고일자"]))} ${str(item["사건번호"])} 전원합의체 판결이 이 판결을 변경한 것으로 보입니다: "${near}" 그 판결을 읽고 인용하세요`,
      } satisfies Case
  }

  return {
    number,
    result: "ok",
    note: later.length
      ? `${found}. 뒤에 이 판결을 인용한 전원합의체 판결 ${later.length}건 중 최근 것에서 변경 문구를 찾지 못했습니다`
      : found,
  } satisfies Case
})
