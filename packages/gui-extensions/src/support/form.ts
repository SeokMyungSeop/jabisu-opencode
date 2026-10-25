import type { SessionFailure } from "../sdk"

/**
 * 자비수's Google Forms questionnaire for error reports and suggestions. The app only opens it in the browser with
 * some answers filled in; nothing is sent until the user reads it and submits.
 */
export const FORM = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLSfpH-WibX-AXiS92_MqhuEnXdS3I-I8gS6BbuVAUyMOxhpZpA/viewform",
  /** The questions' ids, from the form's pre-filled link. */
  entries: { kind: "entry.1004774369", error: "entry.1917747778", environment: "entry.1254404822" },
  /** The kind question's choices, worded exactly as the form words them. */
  kinds: { report: "오류 신고", feedback: "의견·제안" },
} as const

export type ReportKind = keyof typeof FORM.kinds

// Long errors are cut so the link stays within what browsers and Google Forms accept.
const ERROR_LIMIT = 1500

/** The questionnaire's link with the kind, the error and the environment filled in. */
export function formUrl(input: { kind: ReportKind; error?: string; environment: string }) {
  const url = new URL(FORM.url)
  url.searchParams.set("usp", "pp_url")
  url.searchParams.set(FORM.entries.kind, FORM.kinds[input.kind])

  if (input.error) url.searchParams.set(FORM.entries.error, clip(input.error))
  url.searchParams.set(FORM.entries.environment, input.environment)

  return url.toString()
}

/** One line naming the app version, the system, and the failed model and error type when there is one. */
export function environment(input: { version: string; system?: string; failure?: SessionFailure }) {
  const failure = input.failure
  const model = failure?.provider && failure.model ? `${failure.provider}/${failure.model}` : undefined
  const type = failure ? [failure.type, failure.status].filter((part) => part !== undefined).join(" ") : undefined

  return [`자비수 ${input.version || "?"}`, input.system, model, type].filter(Boolean).join(" · ")
}

/** The platform part of a browser user agent, such as `Windows NT 10.0; Win64; x64`. */
export function system(userAgent: string) {
  return /\(([^)]+)\)/.exec(userAgent)?.[1]
}

function clip(text: string) {
  return text.length <= ERROR_LIMIT ? text : `${text.slice(0, ERROR_LIMIT)}…`
}
