// Whether a request may go out, and to which models: free ones while the install's free share and the account's free
// requests last, the paid one while every money limit holds. Checked before the request; counted after the answer, so
// an answer is never cut off and a small overrun is allowed.
import type { Limits } from "./settings.ts"

export interface Situation {
  readonly now: number
  readonly open: boolean
  /** The notice version the app says the person agreed to, and the one the console needs. */
  readonly consent: string | undefined
  readonly consentVersion: string
  /** Days since the install's first use: 0 on the first day. */
  readonly trialDay: number
  readonly question: boolean
  /** Times of the install's questions in the last hour. */
  readonly recentQuestions: readonly number[]
  readonly freeUsed: number
  /** Free requests left on the OpenRouter account today; undefined when not known yet. */
  readonly freeLeft: number | undefined
  readonly hasFreeModels: boolean
  /** Won of paid use so far. */
  readonly spent: { readonly install: number; readonly ip: number; readonly day: number; readonly month: number }
  /** When the day's limits reset. */
  readonly midnight: number
}

export type Refusal = {
  readonly status: number
  readonly type: string
  readonly message: string
  readonly retryAfter?: number
}

export type Decision =
  | { readonly allow: true; readonly free: boolean; readonly paid: boolean }
  | ({ readonly allow: false } & Refusal)

export const OWN_KEY = "계속 쓰려면 공급자 연결에서 「내 OpenRouter 키」를 연결하세요."

/** Won of paid use allowed on a day of use (0 = the first day): the trial days, then the same small share each day. */
export const allowance = (trialDay: number, limits: Limits) => limits.trialDays[trialDay] ?? limits.afterTrialKrw

/** Requests free models may answer on a day of use: more during the first days, fewer after them. */
export const freeAllowance = (trialDay: number, limits: Limits) =>
  trialDay < limits.trialDays.length ? limits.freeRequestsPerDay : limits.afterTrialFreeRequests

/** The trial is over only when nothing is allowed after its days. */
export const ended = (trialDay: number, limits: Limits) =>
  trialDay >= limits.trialDays.length && limits.afterTrialKrw <= 0

export function decide(at: Situation, limits: Limits): Decision {
  const refuse = (refusal: Refusal): Decision => ({ allow: false, ...refusal })
  const untilMidnight = Math.ceil((at.midnight - at.now) / 1000)

  if (!at.open)
    return refuse({
      status: 503,
      type: "jabisu_free_closed",
      message: `자비수 무료 LLM 콘솔이 지금 쉬고 있어요. ${OWN_KEY}`,
    })
  if (at.consent !== at.consentVersion)
    return refuse({
      status: 403,
      type: "jabisu_free_consent",
      message: `${
        at.consent === undefined
          ? "자비수 무료 LLM 콘솔은 이용 안내에 동의해야 쓸 수 있어요."
          : "자비수 무료 LLM 콘솔 이용 안내가 바뀌었어요."
      } 공급자 연결에서 「자비수 무료 LLM 콘솔」을 다시 연결해 안내에 동의해 주세요.`,
    })
  if (ended(at.trialDay, limits))
    return refuse({
      status: 403,
      type: "jabisu_free_trial_ended",
      message: `무료 체험 기간(${limits.trialDays.length}일)이 끝났어요. 써 주셔서 고마워요. ${OWN_KEY}`,
    })
  if (at.question && at.recentQuestions.length >= limits.questionsPerHour) {
    const oldest = at.recentQuestions[at.recentQuestions.length - limits.questionsPerHour] ?? at.now
    const wait = Math.max(60, Math.ceil((oldest + 3_600_000 - at.now) / 1000))
    return refuse({
      status: 429,
      type: "jabisu_free_hourly",
      message: `자비수 무료 LLM 콘솔은 1시간에 질문 ${limits.questionsPerHour}번까지예요. ${Math.ceil(wait / 60)}분 뒤에 다시 해 주세요. 바로 쓰려면 공급자 연결에서 「내 OpenRouter 키」를 연결하세요.`,
      retryAfter: wait,
    })
  }

  const paid =
    at.spent.install < allowance(at.trialDay, limits) &&
    at.spent.ip < limits.ipDailyKrw &&
    at.spent.day < limits.dailyKrw &&
    at.spent.month < limits.monthlyKrw
  const free =
    at.hasFreeModels &&
    at.freeUsed < freeAllowance(at.trialDay, limits) &&
    (at.freeLeft === undefined || at.freeLeft > limits.freeReserve)

  if (free || paid) return { allow: true, free, paid }
  if (at.spent.day >= limits.dailyKrw || at.spent.month >= limits.monthlyKrw)
    return refuse({
      status: 429,
      type: "jabisu_free_full",
      message: `오늘 자비수 무료 LLM 콘솔을 쓰는 분이 많아 준비한 양이 다 찼어요. 내일 다시 쓸 수 있어요. ${OWN_KEY}`,
      retryAfter: untilMidnight,
    })
  return refuse({
    status: 429,
    type: "jabisu_free_daily",
    message: `오늘의 무료 사용량을 다 썼어요. 내일 다시 쓸 수 있어요. ${OWN_KEY}`,
    retryAfter: untilMidnight,
  })
}

/** How much of today's share is left, in words only: people on the free console never see amounts. */
export function level(at: Pick<Situation, "trialDay" | "spent" | "freeUsed">, limits: Limits) {
  if (ended(at.trialDay, limits)) return "체험 끝"
  const today = allowance(at.trialDay, limits)
  const share = Math.min(today > 0 ? Math.max(0, 1 - at.spent.install / today) : 0, 1)
  const freeToday = freeAllowance(at.trialDay, limits)
  const freeShare = freeToday > 0 ? Math.max(0, 1 - at.freeUsed / freeToday) : 0
  const left = Math.max(share, freeShare)
  if (left > 0.6) return "넉넉해요"
  if (left > 0.25) return "절반쯤 남았어요"
  if (left > 0) return "조금 남았어요"
  return "오늘 몫을 다 썼어요"
}
