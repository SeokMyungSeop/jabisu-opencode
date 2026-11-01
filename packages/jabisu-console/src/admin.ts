// The admin page, served only on 127.0.0.1 of 명상's PC and never through the tunnel: today's and this month's money
// against the limits, the free requests, the model chain and its last check, and each install's use today.
import type { IncomingMessage, ServerResponse } from "node:http"
import { day, month } from "./clock.ts"
import { allowance, freeAllowance } from "./limits.ts"
import { NAME } from "./proxy.ts"
import type { Settings } from "./settings.ts"
import type { Store } from "./store.ts"

export interface Account {
  readonly limitRemaining?: number
  readonly usageDaily?: number
  readonly usageMonthly?: number
  readonly freeLeft?: number
  readonly checked: number
}

export interface AdminDeps {
  readonly settings: Settings
  readonly store: Store
  readonly chain: () => readonly string[]
  readonly account: () => Account | undefined
  readonly open: () => boolean
  readonly setOpen: (open: boolean) => void
  readonly runCheck: () => void
  readonly checking: () => boolean
  readonly now?: () => number
}

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  )

const won = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`

const time = (value: number) =>
  new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

export function adminHandler(deps: AdminDeps) {
  const now = deps.now ?? Date.now
  const { settings, store } = deps
  const krw = (usd: number) => usd * settings.krwPerUsd

  const page = () => {
    const at = now()
    const today = day(at)
    const since = day(at - 13 * 86_400_000)
    const report = store.report(today, since)
    const check = store.lastCheck()
    const account = deps.account()
    const todayKrw = krw(store.spent.day(today))
    const monthKrw = krw(store.spent.month(month(at)))
    const days = report.days as { day: string; cost: number; free: number; requests: number; installs: number }[]
    const top = Math.max(1, ...days.map((d) => krw(d.cost)))
    const bar = (value: number, limit: number) =>
      `<div class="meter"><span style="width:${Math.min(100, (value / limit) * 100).toFixed(1)}%"></span></div>`

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30"><title>${NAME} 관리</title><style>
:root{--bg:#f7f6f2;--fg:#1d2433;--muted:#667085;--line:#e3e1da;--accent:#1b2a4b;--ok:#2f7d4f;--warn:#b54708}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 "Pretendard","Malgun Gothic",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}
.muted{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card b{font-size:20px;display:block}
.meter{height:6px;background:var(--line);border-radius:3px;margin-top:6px}.meter span{display:block;height:100%;background:var(--accent);border-radius:3px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;font-variant-numeric:tabular-nums}th{font-size:13px;color:var(--muted);font-weight:600}
.ok{color:var(--ok)}.bad{color:var(--warn)}button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.ghost{background:#fff;color:var(--accent)}form{display:inline}.bars{display:flex;gap:6px;align-items:flex-end;height:90px}
.bars div{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;position:relative}.days{display:flex;gap:6px;font-size:11px;color:var(--muted)}.days span{flex:1;text-align:center}
code{font-size:13px}</style></head><body><main>
<h1>${NAME} 관리</h1><p class="muted">명상 PC에서만 열려요 · 30초마다 새로 고침 · ${escape(time(at))}</p>
<p>상태: ${deps.open() ? '<b class="ok">열림</b>' : '<b class="bad">쉬는 중</b>'}
<form method="post" action="${deps.open() ? "/close" : "/open"}"><button class="ghost">${deps.open() ? "창구 닫기" : "창구 열기"}</button></form></p>
<div class="cards">
<div class="card"><span class="muted">오늘 유료 사용</span><b>${won(todayKrw)}</b><span class="muted">하루 한도 ${won(settings.limits.dailyKrw)}</span>${bar(todayKrw, settings.limits.dailyKrw)}</div>
<div class="card"><span class="muted">이번 달 유료 사용</span><b>${won(monthKrw)}</b><span class="muted">월 한도 ${won(settings.limits.monthlyKrw)}</span>${bar(monthKrw, settings.limits.monthlyKrw)}</div>
<div class="card"><span class="muted">오늘 무료 모델 요청</span><b>${days.find((d) => d.day === today)?.free ?? 0}번</b><span class="muted">OpenRouter 무료 남은 횟수 ${account?.freeLeft ?? "?"}</span></div>
<div class="card"><span class="muted">OpenRouter 키 남은 한도</span><b>${account?.limitRemaining === undefined ? "?" : `$${account.limitRemaining.toFixed(2)}`}</b><span class="muted">이번 달 키 사용 ${account?.usageMonthly === undefined ? "?" : `$${account.usageMonthly.toFixed(3)}`}</span></div>
<div class="card"><span class="muted">안내 동의</span><b>${report.consents}건</b><span class="muted">안내문 판 ${escape(settings.consentVersion)}</span></div>
</div>
<h2>최근 14일 유료 사용</h2>
<div class="bars">${days.map((d) => `<div title="${escape(d.day)} ${won(krw(d.cost))} · 무료 ${d.free}번 · ${d.installs}명" style="height:${((krw(d.cost) / top) * 100).toFixed(1)}%"></div>`).join("")}</div>
<div class="days">${days.map((d) => `<span>${escape(d.day.slice(5))}</span>`).join("")}</div>
<h2>모델 순서 <form method="post" action="/check"><button class="ghost"${deps.checking() ? " disabled" : ""}>${deps.checking() ? "점검 중…" : "지금 점검"}</button></form></h2>
<p>${[...deps.chain(), `${settings.paidModel} (유료)`].map((m, i) => `${i + 1}. <code>${escape(m)}</code>`).join(" → ")}</p>
<p class="muted">마지막 점검: ${check ? escape(time(check.time)) : "아직 없음"} · 하루 한 번, 그리고 무료 모델이 잇달아 실패하면 다시 점검해요.</p>
${
  check
    ? `<table><tr><th>후보</th><th>결과</th><th>걸린 시간</th><th>이유</th></tr>${check.log
        .map(
          (e) =>
            `<tr><td><code>${escape(e.model)}</code></td><td class="${e.ok ? "ok" : "bad"}">${e.ok ? "통과" : "탈락"}</td><td>${(e.ms / 1000).toFixed(1)}초</td><td>${escape(e.reason ?? "")}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}
<h2>오늘 모델별</h2>
<table><tr><th>모델</th><th>요청</th><th>유료 사용</th></tr>${
      (report.models as { model: string; requests: number; cost: number }[])
        .map(
          (m) => `<tr><td><code>${escape(m.model)}</code></td><td>${m.requests}</td><td>${won(krw(m.cost))}</td></tr>`,
        )
        .join("") || '<tr><td colspan="3" class="muted">아직 없어요</td></tr>'
    }</table>
<h2>오늘 설치 번호별</h2>
<table><tr><th>설치 번호</th><th>체험</th><th>유료 사용</th><th>무료 요청</th><th>질문</th><th>주소 수</th><th>마지막</th></tr>${
      (
        report.installs as {
          install: string
          first_day: string
          cost: number
          free: number
          questions: number
          ips: number
          last: number
        }[]
      )
        .map((r) => {
          const trial = Math.round((Date.parse(today) - Date.parse(r.first_day)) / 86_400_000) + 1
          return `<tr><td><code>${escape(r.install.slice(0, 8))}</code></td><td>${trial}일째</td><td>${won(krw(r.cost))} / ${won(allowance(trial - 1, settings.limits))}</td><td>${r.free} / ${freeAllowance(trial - 1, settings.limits)}</td><td>${r.questions}</td><td>${r.ips}</td><td>${escape(time(r.last))}</td></tr>`
        })
        .join("") || '<tr><td colspan="7" class="muted">아직 없어요</td></tr>'
    }</table>
<p class="muted">대화 내용은 저장하지 않아요. 숫자(모델·토큰·금액·시각)만 남겨요. 금액은 1달러 ${settings.krwPerUsd}원으로 계산해요.</p>
</main></body></html>`
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    // A page on another site must not be able to press these buttons through the browser.
    const host = String(req.headers.host ?? "")
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403).end()
      return
    }
    if (req.method === "POST") {
      const origin = req.headers.origin
      if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        res.writeHead(403).end()
        return
      }
      if (req.url === "/open") deps.setOpen(true)
      if (req.url === "/close") deps.setOpen(false)
      if (req.url === "/check") deps.runCheck()
      res.writeHead(303, { location: "/" }).end()
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    res.end(page())
  }
}
