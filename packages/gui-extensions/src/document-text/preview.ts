/**
 * Lays out converted document text for the Markdown renderer. The converter writes one paragraph per line, which
 * Markdown would join, so every line but a table row ends its paragraph, and leading indentation stays visible instead
 * of turning a line into a code block. List items keep their indentation, which nests them.
 */
export function previewMarkdown(text: string) {
  const lines = text.split("\n")

  return lines
    .map((line, index) => {
      const kept = /^\s*([-*+]|\d+\.)\s/.test(line)
        ? line
        : line.replace(/^[\t ]+/, (indent) => " ".repeat(indent.replace(/\t/g, "    ").length))

      return line.startsWith("|") && lines[index + 1]?.startsWith("|") ? kept : `${kept}\n`
    })
    .join("\n")
}
