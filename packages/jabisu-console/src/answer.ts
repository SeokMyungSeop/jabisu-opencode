// Reads what an OpenRouter answer used while passing it on: the model that answered, the tokens and the cost. The cost
// is taken out of what goes to the app, so people on the free console never see an amount.

export interface Used {
  model: string | undefined
  cost: number
  input: number
  output: number
}

const COST_FIELDS = ["cost", "cost_details", "is_byok"]

/** Notes the model and usage in one parsed answer object and removes the cost from it. */
export function take(json: Record<string, unknown>, used: Used) {
  if (typeof json.model === "string" && !used.model) used.model = json.model
  const usage = json.usage
  if (!usage || typeof usage !== "object") return false
  const fields = usage as Record<string, unknown>
  if (typeof fields.cost === "number") used.cost = fields.cost
  if (typeof fields.prompt_tokens === "number") used.input = fields.prompt_tokens
  if (typeof fields.completion_tokens === "number") used.output = fields.completion_tokens
  for (const field of COST_FIELDS) delete fields[field]
  return true
}

/**
 * A stream of server-sent events passed through line by line; only a `data:` line that carries usage is parsed and
 * written again without the cost. Comments, other events and partial lines pass through unchanged.
 */
export function events(used: Used) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""

  const line = (text: string) => {
    if (!text.startsWith("data:") || !text.includes('"usage"')) return text
    const body = text.slice(5).trim()
    try {
      const json = JSON.parse(body)
      if (!take(json, used)) return text
      return `data: ${JSON.stringify(json)}`
    } catch {
      return text
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      // Lines without usage go on at once, so the answer streams as it is written.
      for (const text of lines) {
        const model = text.startsWith("data:") && !used.model ? /"model"\s*:\s*"([^"]+)"/.exec(text)?.[1] : undefined
        if (model) used.model = model
        controller.enqueue(encoder.encode(line(text.replace(/\r$/, "")) + (text.endsWith("\r") ? "\r\n" : "\n")))
      }
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending) controller.enqueue(encoder.encode(line(pending)))
    },
  })
}
