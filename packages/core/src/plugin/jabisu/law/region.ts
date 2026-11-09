export * as LawRegion from "./region.js"

// The 지자체 whose ordinances a search looks in first: the user's own, read from the 소속 line of their 업무 프로필,
// or one the model names. law.go.kr names an ordinance after its 지자체 (세종특별자치시 지방공무원 여비 조례, 수원시
// 주차장 조례, 대구광역시 중구 주차장 조례) and gives each result's 지자체기관명 (세종특별자치시, 경기도 수원시,
// 대구광역시 중구, 충청북도교육청). A search adds the 지자체's word to the query, which law.go.kr finds inside longer
// words too (세종특별자치시의회, 충청북도교육감), and keeps the results of that 기관, since the same word names several
// 지자체 (중구 in six cities, 고성군 in 강원 and 경남).

export interface Region {
  /** The 지자체기관명 as law.go.kr writes it, such as 경기도 수원시; only the 시·군·구 when its 시·도 is unknown. */
  readonly name: string
  /** The word its ordinances' names carry: the 시·군·구, else the 시·도. */
  readonly word: string
  /** Whether the 시·도 is unknown, so that 기관 names ending in the word all match. */
  readonly partial: boolean
  /** The 시·도 above a 시·군·구, whose own ordinances may apply there too. */
  readonly province?: string
}

// Every 시·도 under the name law.go.kr gives it now, with the names people still write for it. 광주광역시 and
// 전라남도 became 전남광주통합특별시; law.go.kr lists their old ordinances under (구)광주광역시.
const PROVINCES: readonly (readonly [string, readonly string[]])[] = [
  ["서울특별시", ["서울시", "서울"]],
  ["부산광역시", ["부산시", "부산"]],
  ["대구광역시", ["대구시", "대구"]],
  ["인천광역시", ["인천시", "인천"]],
  ["대전광역시", ["대전시", "대전"]],
  ["울산광역시", ["울산시", "울산"]],
  ["세종특별자치시", ["세종시", "세종"]],
  ["경기도", []],
  ["강원특별자치도", ["강원도"]],
  ["충청북도", ["충북"]],
  ["충청남도", ["충남"]],
  ["전북특별자치도", ["전라북도", "전북"]],
  // 광주시 is also a 시 in 경기도, so only the full old name means the 광역시.
  ["전남광주통합특별시", ["전남광주", "광주전남", "광주광역시", "전라남도", "전남"]],
  ["경상북도", ["경북"]],
  ["경상남도", ["경남"]],
  ["제주특별자치도", ["제주도", "제주"]],
]

/** The words that mean every 지자체. */
export const EVERYWHERE = ["전국", "전체", "모두"]

// A 기관's office is often written with 청 (경기도청, 수원시청); the 지자체 is the same.
const office = (word: string) => (word.endsWith("청") ? word.slice(0, -1) : word)

const province = (word: string) =>
  PROVINCES.find(([name, others]) => name === office(word) || others.includes(office(word)))?.[0]

// A 시·도's 교육청 (충청북도교육청, 세종시교육청) makes its own ordinances and rules.
const education = (word: string) => {
  const above = /^(.+)교육청$/.exec(word)?.[1]

  return above === undefined ? undefined : province(above)
}

// A 시·군·구 is a word of two or more letters ending in 시, 군 or 구 (수원시, 가평군, 강남구); 도시 and the like are
// not, because a 시·군·구 only counts right after a 시·도 or as the first word.
const district = (word: string) => {
  const name = office(word)

  return name.length >= 2 && /[시군구]$/.test(name) && !province(name) ? name : undefined
}

/** The 지자체 a text names, such as 「세종특별자치시 미래전략본부」, 「경기도청 ○○과」 or 「수원시청」; none for others. */
export function parse(text: string): Region | undefined {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const at = words.findIndex((word) => province(word) !== undefined || education(word) !== undefined)

  if (at === -1) {
    const first = words[0] === undefined ? undefined : district(words[0])

    return first ? { name: first, word: first, partial: true } : undefined
  }
  const schools = education(words[at]!)

  if (schools) return { name: `${schools}교육청`, word: schools, partial: false }
  const top = province(words[at]!)!
  const below = words[at + 1] === undefined ? undefined : district(words[at + 1]!)

  return below
    ? { name: `${top} ${below}`, word: below, partial: false, province: top }
    : { name: top, word: top, partial: false }
}

/** The user's 지자체 from the 소속 line of their 업무 프로필, when it names one. */
export function fromProfile(profile: string) {
  const line = /^\s*[-*]?\s*소속\s*[:：]\s*(.+)$/m.exec(profile)?.[1]

  return line ? parse(line) : undefined
}

/** Whether a result's 지자체기관명 is this 지자체. */
export const matches = (region: Region, org: string | undefined) =>
  !!org && (region.partial ? org === region.word || org.endsWith(` ${region.word}`) : org === region.name)

/** The query that finds this 지자체's ordinances: its word first, unless the query already has it. */
export const query = (region: Region, words: string) =>
  words.split(/\s+/).includes(region.word) ? words : `${region.word} ${words}`
