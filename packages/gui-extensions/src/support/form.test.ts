import { expect, test } from "bun:test"
import { environment, FORM, formUrl, system } from "./form"

test("fills the kind, the error and the environment into the questionnaire's link", () => {
  const url = new URL(formUrl({ kind: "report", error: "User not found.", environment: "자비수 1.3.2" }))

  expect(`${url.origin}${url.pathname}`).toBe(FORM.url)
  expect(url.searchParams.get("usp")).toBe("pp_url")
  expect(url.searchParams.get(FORM.entries.kind)).toBe("오류 신고")
  expect(url.searchParams.get(FORM.entries.error)).toBe("User not found.")
  expect(url.searchParams.get(FORM.entries.environment)).toBe("자비수 1.3.2")
})

test("leaves the error out of feedback and cuts a long error", () => {
  const feedback = new URL(formUrl({ kind: "feedback", environment: "자비수 1.3.2" }))
  expect(feedback.searchParams.get(FORM.entries.kind)).toBe("의견·제안")
  expect(feedback.searchParams.has(FORM.entries.error)).toBe(false)

  const long = new URL(formUrl({ kind: "report", error: "x".repeat(5000), environment: "" }))
  expect(long.searchParams.get(FORM.entries.error)).toBe(`${"x".repeat(1500)}…`)
})

test("describes the app, the system and the failed model without the conversation", () => {
  expect(
    environment({
      version: "1.3.2",
      system: "Windows NT 10.0; Win64; x64",
      failure: { type: "provider.auth", status: 401, message: "User not found.", provider: "openrouter", model: "m" },
    }),
  ).toBe("자비수 1.3.2 · Windows NT 10.0; Win64; x64 · openrouter/m · provider.auth 401")
  expect(environment({ version: "", system: undefined })).toBe("자비수 ?")
})

test("reads the platform from a user agent", () => {
  expect(system("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/1 Electron/2")).toBe(
    "Windows NT 10.0; Win64; x64",
  )
  expect(system("plain")).toBeUndefined()
})
