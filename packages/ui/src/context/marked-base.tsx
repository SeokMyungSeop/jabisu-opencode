import { Marked } from "marked"

// Only ~~double~~ tildes strike text through. GFM also strikes a single pair, but a single tilde is how Korean
// writes ranges, as in 「제86조~제87조, 제88조~제93조」, which would otherwise lose everything between them to a line.
const doubleTildeDel = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?!~)/

export function createMarkdownBase() {
  return new Marked({
    renderer: {
      link({ href, title, tokens }) {
        const titleAttr = title ? ` title="${title}"` : ""

        return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`
      },
    },
    tokenizer: {
      // Returning nothing (not false) keeps marked's own single-tilde rule from running after this one.
      del(src) {
        const match = doubleTildeDel.exec(src)

        if (!match) return

        return { type: "del", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) }
      },
    },
  })
}

let smallParser: Marked | undefined

export function parseSmallMarkdown(text: string) {
  // Any possible KaTeX delimiter stays on the worker, including escaped ones.
  // Dollar math needs a pair, so a lone price such as `$5` can stay on this path.
  if (text.length > 1024 || text.includes("\\(") || text.indexOf("$") !== text.lastIndexOf("$")) return

  // Ordinary prose does not need the block/inline lexer's cold regular expressions.
  // Keep every possible Markdown construct, autolink, and hard break on that lexer.
  if (
    /^[\p{L}\p{N} \t\r\n,.;:!?'"’“”()\-–—…$%]+$/u.test(text) &&
    !/(?:^|[\r\n])(?:[ \t]|\d|[-])| {2}(?:\r\n?|\n)|www\./.test(text)
  ) {
    return text
      .replace(/\r\n?/g, "\n")
      .replace(/^\n+|\n+$/g, "")
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((paragraph) => `<p>${paragraph.replace(/["']/g, (value) => (value === '"' ? "&quot;" : "&#39;"))}</p>\n`)
      .join("")
  }

  const parser = (smallParser ??= createMarkdownBase())
  const paragraphs = text.replace(/\r\n?/g, "\n")

  // Inline formatting in ordinary paragraphs does not need the block lexer.
  // Any possible block opener, HTML, table, or reference definition stays on it.
  if (
    !/[<|]/.test(paragraphs) &&
    !/^(?:[ \t>\d\[\-=]|#{1,6}(?:[ \t]|$)|[`~]{3}|[+*](?:[ \t]|$)|(?:[*_][ \t]*){3,}$)/m.test(paragraphs)
  ) {
    return paragraphs
      .replace(/^\n+|\n+$/g, "")
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((paragraph) => `<p>${parser.parseInline(paragraph, { async: false })}</p>\n`)
      .join("")
  }

  const tokens = parser.lexer(text)
  let code = false
  parser.walkTokens(tokens, (token) => {
    if (token.type === "code") code = true
  })

  if (code) return

  return parser.parser(tokens)
}
