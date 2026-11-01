import assert from "node:assert/strict"
import { test } from "node:test"
import { decide, level, type Situation } from "../src/limits.ts"
import { defaults } from "../src/settings.ts"

const limits = defaults("x").limits
const now = Date.parse("2026-11-02T03:00:00Z")
const base: Situation = {
  now,
  open: true,
  consent: "1",
  consentVersion: "1",
  trialDay: 0,
  question: true,
  recentQuestions: [],
  freeUsed: 0,
  freeLeft: 900,
  hasFreeModels: true,
  spent: { install: 0, ip: 0, day: 0, month: 0 },
  midnight: Date.parse("2026-11-02T15:00:00Z"),
}

test("a new install may use free models first and the paid one after", () => {
  assert.deepEqual(decide(base, limits), { allow: true, free: true, paid: true })
})

test("the console being closed, a missing or old consent, and a finished trial refuse with a reason", () => {
  assert.equal(decide({ ...base, open: false }, limits).allow, false)
  const closed = decide({ ...base, open: false }, limits)
  assert.equal(!closed.allow && closed.final, true)
  const consent = decide({ ...base, consent: undefined }, limits)
  assert.equal(!consent.allow && consent.type, "jabisu_free_consent")
  assert.equal(!consent.allow && consent.status, 403)
  const old = decide({ ...base, consent: "0" }, limits)
  assert.equal(!old.allow && old.type, "jabisu_free_consent")
  // With nothing allowed after the first days, the trial ends there.
  const ended = decide({ ...base, trialDay: 7 }, { ...limits, afterTrialKrw: 0 })
  assert.equal(!ended.allow && ended.type, "jabisu_free_trial_ended")
  assert.match(!ended.allow ? ended.message : "", /OpenRouter 키/)
})

test("the tenth question in an hour is the last; tool steps do not count", () => {
  const recent = Array.from({ length: 10 }, (_, i) => now - 50 * 60_000 + i * 60_000)
  const refused = decide({ ...base, recentQuestions: recent }, limits)
  assert.equal(!refused.allow && refused.type, "jabisu_free_hourly")
  // The oldest of the ten leaves the window ten minutes from now.
  assert.equal(!refused.allow && refused.retryAfter, 600)
  assert.equal(decide({ ...base, recentQuestions: recent, question: false }, limits).allow, true)
})

test("after the first seven days each day still allows ₩50 of paid use, with no end", () => {
  assert.deepEqual(decide({ ...base, trialDay: 7 }, limits), { allow: true, free: true, paid: true })
  assert.deepEqual(decide({ ...base, trialDay: 90, spent: { ...base.spent, install: 40 } }, limits), {
    allow: true,
    free: true,
    paid: true,
  })
  assert.deepEqual(decide({ ...base, trialDay: 90, spent: { ...base.spent, install: 50 } }, limits), {
    allow: true,
    free: true,
    paid: false,
  })
})

test("after the first seven days free models answer 30 requests a day instead of 100", () => {
  assert.deepEqual(decide({ ...base, trialDay: 6, freeUsed: 99 }, limits), { allow: true, free: true, paid: true })
  assert.deepEqual(decide({ ...base, trialDay: 7, freeUsed: 29 }, limits), { allow: true, free: true, paid: true })
  assert.deepEqual(decide({ ...base, trialDay: 7, freeUsed: 30 }, limits), { allow: true, free: false, paid: true })
  assert.equal(level({ trialDay: 7, spent: { ...base.spent, install: 50 }, freeUsed: 15 }, limits), "절반쯤 남았어요")
})

test("each money limit stops only the paid model while free requests last", () => {
  for (const spent of [
    { install: 300, ip: 0, day: 0, month: 0 },
    { install: 0, ip: 1000, day: 0, month: 0 },
    { install: 0, ip: 0, day: 1600, month: 0 },
    { install: 0, ip: 0, day: 0, month: 50000 },
  ])
    assert.deepEqual(decide({ ...base, spent }, limits), { allow: true, free: true, paid: false })
  // The second day allows ₩200, so ₩250 spent is over it.
  assert.deepEqual(decide({ ...base, trialDay: 1, spent: { ...base.spent, install: 250 } }, limits), {
    allow: true,
    free: true,
    paid: false,
  })
})

test("free models are skipped when the install's share, the account's reserve or the chain runs out", () => {
  assert.deepEqual(decide({ ...base, freeUsed: 100 }, limits), { allow: true, free: false, paid: true })
  assert.deepEqual(decide({ ...base, freeLeft: 50 }, limits), { allow: true, free: false, paid: true })
  assert.deepEqual(decide({ ...base, hasFreeModels: false }, limits), { allow: true, free: false, paid: true })
})

test("with neither left the install waits for midnight; a full console says so", () => {
  const daily = decide({ ...base, freeUsed: 100, spent: { ...base.spent, install: 300 } }, limits)
  assert.equal(!daily.allow && daily.type, "jabisu_free_daily")
  assert.equal(!daily.allow && daily.retryAfter, 12 * 3600)
  const full = decide({ ...base, freeUsed: 100, spent: { ...base.spent, day: 1600 } }, limits)
  assert.equal(!full.allow && full.type, "jabisu_free_full")
})

test("the remaining share is told in words only", () => {
  assert.equal(level({ trialDay: 0, spent: base.spent, freeUsed: 0 }, limits), "넉넉해요")
  assert.equal(level({ trialDay: 0, spent: { ...base.spent, install: 300 }, freeUsed: 60 }, limits), "절반쯤 남았어요")
  assert.equal(level({ trialDay: 0, spent: { ...base.spent, install: 300 }, freeUsed: 90 }, limits), "조금 남았어요")
  assert.equal(
    level({ trialDay: 0, spent: { ...base.spent, install: 300 }, freeUsed: 100 }, limits),
    "오늘 몫을 다 썼어요",
  )
  assert.equal(level({ trialDay: 7, spent: base.spent, freeUsed: 0 }, { ...limits, afterTrialKrw: 0 }), "체험 끝")
  assert.equal(
    level({ trialDay: 30, spent: { ...base.spent, install: 50 }, freeUsed: 100 }, limits),
    "오늘 몫을 다 썼어요",
  )
})
