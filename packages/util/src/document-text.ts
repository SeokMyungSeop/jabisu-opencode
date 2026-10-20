export * as DocumentText from "./document-text.js"

import { Parser } from "htmlparser2"

// Converts office and Hangul documents to Markdown-like text. It uses only web platform APIs, so the read tool and
// the app's file preview share one converter.

export type Format = "docx" | "pptx" | "hwpx" | "sheet" | "hwp" | "doc" | "ppt"

/** An expected reason a document has no readable text, reported as its own message. */
export class Unreadable extends Error {}

// Converters hold the whole file, and each decompressed part, in memory.
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024

export const LABELS = {
  docx: "Word document",
  pptx: "PowerPoint presentation",
  hwpx: "HWPX document",
  sheet: "spreadsheet",
  hwp: "HWP document",
  doc: "Word 97-2003 document",
  ppt: "PowerPoint 97-2003 presentation",
} satisfies Record<Format, string>

const EXTENSIONS = new Map<string, Format>([
  ["docx", "docx"],
  ["docm", "docx"],
  ["dotx", "docx"],
  ["dotm", "docx"],
  ["pptx", "pptx"],
  ["pptm", "pptx"],
  ["ppsx", "pptx"],
  ["potx", "pptx"],
  ["hwpx", "hwpx"],
  ["xlsx", "sheet"],
  ["xlsm", "sheet"],
  ["xlsb", "sheet"],
  ["xltx", "sheet"],
  ["ods", "sheet"],
  ["xls", "sheet"],
  ["xlt", "sheet"],
  ["hwp", "hwp"],
  ["hwt", "hwp"],
  ["doc", "doc"],
  ["dot", "doc"],
  ["ppt", "ppt"],
  ["pps", "ppt"],
  ["pot", "ppt"],
])
const ZIPPED = new Set<Format>(["docx", "pptx", "hwpx", "sheet"])
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const COMPOUND_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const HWP_MAGIC = Array.from(new TextEncoder().encode("HWP Document File"))

/** The format a file's extension names, when its leading bytes are that format's container. */
export function detect(file: string, bytes: Uint8Array) {
  const name = file.split(/[\\/]/).pop() ?? ""
  const format = EXTENSIONS.get(name.slice(name.lastIndexOf(".") + 1).toLowerCase())
  if (format === undefined || !name.includes(".")) return
  // Encrypted Office Open XML files are compound files too; `text` reports them as protected.
  if (startsWith(bytes, COMPOUND_MAGIC)) return format
  if (startsWith(bytes, ZIP_MAGIC) && ZIPPED.has(format)) return format
  // HWP 3.0 and older are not compound files; `text` reports them as unsupported.
  if (format === "hwp" && startsWith(bytes, HWP_MAGIC)) return format
}

/** The format of a document from its contents alone, for bytes that arrive without a file name. */
export async function sniff(bytes: Uint8Array): Promise<Format | undefined> {
  if (startsWith(bytes, HWP_MAGIC)) return "hwp"
  if (startsWith(bytes, ZIP_MAGIC)) {
    const names = new Set(zip(bytes).names)
    if (names.has("Contents/section0.xml") || names.has("Contents/content.hpf")) return "hwpx"
    if (names.has("word/document.xml")) return "docx"
    if (names.has("ppt/presentation.xml")) return "pptx"
    if (names.has("xl/workbook.xml") || names.has("xl/workbook.bin") || names.has("content.xml")) return "sheet"
    return
  }
  if (!startsWith(bytes, COMPOUND_MAGIC)) return
  const streams = await compound(bytes)
  if (streams.has("/FileHeader")) return "hwp"
  if (streams.has("/WordDocument")) return "doc"
  if (streams.has("/PowerPoint Document")) return "ppt"
  if (streams.has("/Workbook") || streams.has("/Book")) return "sheet"
  if (streams.has("/EncryptedPackage")) throw new Unreadable("it is password-protected (encrypted)")
}

export async function text(format: Format, bytes: Uint8Array) {
  if (format === "sheet") return sheet(bytes)
  if (!startsWith(bytes, COMPOUND_MAGIC)) {
    if (format === "hwp") throw new Unreadable("HWP 3.0 and older documents are not supported; save it as HWPX first")
    const archive = zip(bytes)
    if (format === "docx") return docx(archive)
    if (format === "pptx") return pptx(archive)
    return hwpx(archive)
  }
  if (format === "docx" || format === "pptx" || format === "hwpx")
    throw new Unreadable("it is password-protected (encrypted)")
  const streams = await compound(bytes)
  if (format === "hwp") return hwp(streams)
  if (format === "doc") return doc(streams)
  return ppt(streams)
}

// Stream paths without the root entry's name, such as "/BodyText/Section0".
async function compound(bytes: Uint8Array) {
  const { CFB } = await import("xlsx")
  // SheetJS types its CFB reader as `any`; these are the parts of its container this module reads. Its contents are
  // Node buffers or plain arrays, depending on the runtime.
  const container: { readonly FullPaths: string[]; readonly FileIndex: { readonly content?: ArrayLike<number> }[] } =
    CFB.read(bytes, { type: "array" })
  return new Map(
    container.FullPaths.flatMap((name, index) => {
      const content = container.FileIndex[index].content
      if (!content || content.length === 0) return []
      return [[name.slice(name.indexOf("/")), content instanceof Uint8Array ? content : Uint8Array.from(content)]]
    }),
  )
}

async function sheet(bytes: Uint8Array) {
  const { read, utils } = await import("xlsx")
  // Number format 14 is the reader's locale short date, which SheetJS would print as US m/d/yy.
  const workbook = read(bytes, {
    type: "array",
    dense: true,
    dateNF: "yyyy-mm-dd",
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
  })
  return workbook.SheetNames.map((name, index) => {
    const hidden = workbook.Workbook?.Sheets?.[index]?.Hidden ? " (hidden)" : ""
    const csv = utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false, strip: true }).trimEnd()
    return `## Sheet: ${name}${hidden}\n${csv || "(empty)"}`
  }).join("\n\n")
}

// Office Open XML

async function docx(archive: Zip) {
  const document = await archive.xml("word/document.xml")
  const body = document && first(document, "w:document", "w:body")
  if (!body) throw new Unreadable("it has no document body; it may be damaged")
  // Headings come from a style's name or outline level, and list items also from numbering a style carries, as
  // "List Bullet 2" does at the second level.
  const styles = new Map(
    elements((await archive.xml("word/styles.xml")) ?? EMPTY, "w:styles", "w:style").map((style) => {
      const name = first(style, "w:name")?.attributes["w:val"] ?? ""
      const properties = first(style, "w:pPr")
      return [
        style.attributes["w:styleId"],
        {
          heading: name === "Title" ? 1 : Number(/^heading (\d)$/i.exec(name)?.[1] ?? outline(properties)),
          list: first(properties, "w:numPr") ? Number(/ (\d)$/.exec(name)?.[1] ?? 1) - 1 : undefined,
        },
      ] as const
    }),
  )
  return lines(docxBlocks(body, styles))
}

type DocxStyles = Map<string, { readonly heading: number; readonly list?: number }>

function docxBlocks(node: Element, styles: DocxStyles): string[] {
  return node.children.flatMap((child) => {
    if (typeof child === "string") return []
    if (child.name === "w:p") return [docxParagraph(child, styles)]
    if (child.name === "w:tbl")
      return [
        table(
          elements(child, "w:tr").map((row) =>
            elements(row, "w:tc").flatMap((cell) => {
              const span = Number(first(cell, "w:tcPr", "w:gridSpan")?.attributes["w:val"] ?? 1)
              const content = docxBlocks(cell, styles).filter(Boolean).join("\n")
              return [content, ...Array<string>(Math.max(0, span - 1)).fill("")]
            }),
          ),
        ),
      ]
    // Content controls, custom XML and similar wrappers hold ordinary blocks.
    return docxBlocks(child, styles)
  })
}

function docxParagraph(paragraph: Element, styles: DocxStyles) {
  const properties = first(paragraph, "w:pPr")
  const content = inline(paragraph, DOCX_INLINE).trimEnd()
  if (content.trim() === "") return ""
  const style = styles.get(first(properties, "w:pStyle")?.attributes["w:val"] ?? "")
  const level = style?.heading || outline(properties)
  if (level > 0) return `${"#".repeat(Math.min(level, 6))} ${content.trim()}`
  const numbering = first(properties, "w:numPr")
  // Numbering ID 0 turns off the numbering the paragraph's style would apply.
  const list =
    first(numbering, "w:numId")?.attributes["w:val"] === "0"
      ? undefined
      : numbering
        ? Number(first(numbering, "w:ilvl")?.attributes["w:val"] ?? style?.list ?? 0)
        : style?.list
  if (list === undefined) return content
  return `${"  ".repeat(list)}- ${content.trim()}`
}

// Word's outline levels count from 0; 9 means body text.
function outline(properties: Element | undefined) {
  const level = Number(first(properties, "w:outlineLvl")?.attributes["w:val"] ?? 9)
  return level < 9 ? level + 1 : 0
}

const DOCX_INLINE: Inline = {
  text: new Set(["w:t"]),
  breaks: { "w:tab": "\t", "w:br": "\n", "w:cr": "\n", "w:noBreakHyphen": "-" },
  // Properties hold tab stops, not tabs; deleted revisions and field codes are not visible text, and a
  // fallback repeats its alternate content for older readers.
  skip: new Set(["w:pPr", "w:rPr", "w:del", "w:instrText", "w:delInstrText", "mc:Fallback"]),
  paragraph: "w:p",
}

async function pptx(archive: Zip) {
  const presentation = await archive.xml("ppt/presentation.xml")
  if (!presentation) throw new Unreadable("it has no presentation part; it may be damaged")
  const slides = await relationships(archive, "ppt/presentation.xml")
  const parts = elements(presentation, "p:presentation", "p:sldIdLst", "p:sldId").flatMap((slide) => {
    const part = slides.get(slide.attributes["r:id"])?.target
    return part === undefined ? [] : [part]
  })
  const rendered = await Promise.all(
    parts.map(async (part, index) => {
      const slide = (await archive.xml(part)) ?? EMPTY
      const title = descendants(slide, "p:sp").find((shape) => ["title", "ctrTitle"].includes(placeholder(shape) ?? ""))
      const notes = [...(await relationships(archive, part)).values()].find((item) => item.type.endsWith("/notesSlide"))
      const notesText = descendants((await archive.xml(notes?.target ?? "")) ?? EMPTY, "p:sp")
        .filter((shape) => placeholder(shape) === "body")
        .flatMap((shape) => drawing(shape))
      return [
        `## Slide ${index + 1}${title ? `: ${drawing(title).join(" ")}` : ""}`,
        ...drawing(slide, title),
        ...(notesText.length === 0 ? [] : ["### Notes", ...notesText]),
      ].join("\n")
    }),
  )
  return rendered.join("\n\n")
}

function placeholder(shape: Element) {
  return first(shape, "p:nvSpPr", "p:nvPr", "p:ph")?.attributes.type
}

// DrawingML text: paragraphs and tables, in document order, leaving out one shape such as the title.
function drawing(node: Element, omit?: Element): string[] {
  return node.children.flatMap((child) => {
    if (typeof child === "string" || child === omit || child.name === "mc:Fallback") return []
    if (child.name === "a:p") {
      const content = inline(child, DRAWING_INLINE).trimEnd()
      return content.trim() === "" ? [] : [content]
    }
    if (child.name === "a:tbl")
      return [
        table(
          elements(child, "a:tr").map((row) =>
            elements(row, "a:tc").map((cell) =>
              // Merged-over cells repeat nothing; their text stays in the cell that spans them.
              cell.attributes.hMerge || cell.attributes.vMerge ? "" : drawing(cell).join("\n"),
            ),
          ),
        ),
      ]
    return drawing(child, omit)
  })
}

const DRAWING_INLINE: Inline = {
  text: new Set(["a:t"]),
  breaks: { "a:br": "\n" },
  skip: new Set(["a:pPr", "a:rPr", "a:endParaRPr"]),
  paragraph: "a:p",
}

// A part's relationships, with targets resolved against the part's folder.
async function relationships(archive: Zip, part: string) {
  const directory = part.slice(0, part.lastIndexOf("/") + 1)
  const rels = (await archive.xml(`${directory}_rels/${part.slice(directory.length)}.rels`)) ?? EMPTY
  return new Map(
    elements(rels, "Relationships", "Relationship").flatMap((item) => {
      if (item.attributes.TargetMode === "External") return []
      const target = item.attributes.Target ?? ""
      return [
        [
          item.attributes.Id,
          {
            type: item.attributes.Type ?? "",
            target: target.startsWith("/") ? target.slice(1) : resolve(directory, target),
          },
        ] as const,
      ]
    }),
  )
}

function resolve(directory: string, target: string) {
  return `${directory}${target}`
    .split("/")
    .reduce<string[]>((parts, part) => {
      if (part === "..") return parts.slice(0, -1)
      if (part === "." || part === "") return parts
      return [...parts, part]
    }, [])
    .join("/")
}

// HWPX (OWPML)

async function hwpx(archive: Zip) {
  const sections = archive.names
    .flatMap((name) => {
      const index = /^Contents\/section(\d+)\.xml$/i.exec(name)?.[1]
      return index === undefined ? [] : [{ name, index: Number(index) }]
    })
    .sort((a, b) => a.index - b.index)
  if (sections.length === 0) throw new Unreadable("it has no sections; it may be damaged or encrypted")
  const texts = await Promise.all(
    sections.map(async (section) => lines(hwpxBlocks((await archive.xml(section.name)) ?? EMPTY))),
  )
  return texts.join("\n\n")
}

function hwpxBlocks(node: Element): string[] {
  return node.children.flatMap((child) => {
    if (typeof child === "string") return []
    if (child.name === "hp:p") return [inline(child, HWPX_INLINE).trimEnd(), ...hwpxNested(child)]
    if (child.name === "hp:tbl") return [hwpxTable(child)]
    return hwpxBlocks(child)
  })
}

// Tables and text boxes anchored in a paragraph follow its own text; headers, footers and notes are left out.
function hwpxNested(node: Element): string[] {
  return node.children.flatMap((child) => {
    if (typeof child === "string" || child.name === "hp:t") return []
    if (child.name === "hp:tbl") return [hwpxTable(child)]
    if (child.name === "hp:drawText") return hwpxBlocks(child)
    if (HWPX_INLINE.skip.has(child.name)) return []
    return hwpxNested(child)
  })
}

// Cells carry their own addresses, so merged cells leave the cells they cover empty.
function hwpxTable(node: Element) {
  const grid: string[][] = []
  for (const row of elements(node, "hp:tr"))
    for (const cell of elements(row, "hp:tc")) {
      const address = first(cell, "hp:cellAddr")?.attributes
      const rowIndex = Number(address?.rowAddr ?? grid.length)
      grid[rowIndex] ??= []
      grid[rowIndex][Number(address?.colAddr ?? grid[rowIndex].length)] = hwpxBlocks(cell).filter(Boolean).join("\n")
    }
  return table(Array.from(grid, (row) => Array.from(row ?? [], (cell) => cell ?? "")))
}

const HWPX_INLINE: Inline = {
  text: new Set(["hp:t"]),
  breaks: { "hp:tab": "\t", "hp:lineBreak": "\n", "hp:fwSpace": " ", "hp:nbSpace": " ", "hp:hyphen": "-" },
  // Tables, text boxes, headers, footers and notes are blocks of their own.
  skip: new Set(["hp:tbl", "hp:drawText", "hp:ctrl", "hp:secPr", "hp:linesegarray", "hp:subList"]),
  paragraph: "hp:p",
}

// HWP 5.0: a compound file whose BodyText sections are record streams.

const HWPTAG_PARA_TEXT = 0x43
const HWPTAG_LIST_HEADER = 0x48
const HWPTAG_TABLE = 0x4d
// Controls stored inline as 8 code units: the code, its 12-byte payload and the code again.
const HWP_EXTENDED = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
const HWP_CHARACTERS = new Map([
  [9, "\t"],
  [10, "\n"],
  [24, "-"],
  [30, " "],
  [31, " "],
])

async function hwp(streams: Map<string, Uint8Array>) {
  const header = streams.get("/FileHeader")
  if (!header || header.length < 40 || !startsWith(header, HWP_MAGIC))
    throw new Unreadable("it is not a valid HWP document")
  const flags = view(header).getUint32(36, true)
  if (flags & 0b10) throw new Unreadable("it is password-protected (encrypted)")
  if (flags & 0b100) throw new Unreadable("it is a distribution document (배포용 문서), whose text HWP encrypts")
  const sections = [...streams.keys()]
    .flatMap((name) => {
      const index = /^\/BodyText\/Section(\d+)$/.exec(name)?.[1]
      return index === undefined ? [] : [{ name, index: Number(index) }]
    })
    .sort((a, b) => a.index - b.index)
  if (sections.length === 0) throw new Unreadable("it has no body text; it may be damaged")
  const texts = await Promise.all(
    sections.map(async (section) => {
      const data = streams.get(section.name) ?? new Uint8Array()
      return hwpSection(flags & 0b1 ? await inflate(data) : data)
    }),
  )
  return texts.join("\n\n")
}

// Records nest by level: a table's TABLE record and its cells' LIST_HEADER and paragraph records share one
// level, so any record at a shallower level ends the table.
function hwpSection(data: Uint8Array) {
  const output: string[] = []
  const tables: { level: number; grid: string[][][]; cell?: string[] }[] = []
  const target = () => tables.at(-1)?.cell ?? output
  const close = () => {
    const rows = Array.from(tables.pop()?.grid ?? [], (row) => Array.from(row ?? [], (cell) => (cell ?? []).join("\n")))
    // A table inside a cell keeps its rows on separate lines of that cell.
    target().push(tables.length === 0 ? table(rows) : rows.map((row) => row.join(" | ")).join("\n"))
  }
  for (const record of hwpRecords(data)) {
    while (tables.length > 0 && record.level < tables[tables.length - 1].level) close()
    const current = tables.at(-1)
    if (record.tag === HWPTAG_TABLE) tables.push({ level: record.level, grid: [] })
    if (record.tag === HWPTAG_LIST_HEADER && current && record.level === current.level && record.body.length >= 12) {
      const body = view(record.body)
      const row = body.getUint16(10, true)
      const cell: string[] = []
      current.grid[row] ??= []
      current.grid[row][body.getUint16(8, true)] = cell
      current.cell = cell
    }
    if (record.tag === HWPTAG_PARA_TEXT) target().push(hwpText(record.body).trimEnd())
  }
  while (tables.length > 0) close()
  return lines(output)
}

function* hwpRecords(data: Uint8Array) {
  const reader = view(data)
  for (let position = 0; position + 4 <= data.length; ) {
    const header = reader.getUint32(position, true)
    const extended = header >>> 20 === 0xfff
    const start = position + (extended ? 8 : 4)
    const size = extended && start <= data.length ? reader.getUint32(position + 4, true) : header >>> 20
    yield { tag: header & 0x3ff, level: (header >>> 10) & 0x3ff, body: data.subarray(start, start + size) }
    position = start + size
  }
}

// UTF-16 code units map one to one onto string characters, so controls can be skipped by position.
function hwpText(body: Uint8Array) {
  const units = UTF16.decode(body.subarray(0, body.length - (body.length % 2)))
  const output: string[] = []
  for (let position = 0; position < units.length; ) {
    const code = units.charCodeAt(position)
    output.push(code >= 32 ? units[position] : (HWP_CHARACTERS.get(code) ?? ""))
    position += HWP_EXTENDED.has(code) ? 8 : 1
  }
  return output.join("")
}

// Word 97-2003: the piece table in the table stream maps the main text's characters into WordDocument.

const WORD_CHARACTERS = new Map([
  [0x0b, "\n"],
  [0x0c, "\n"],
  [0x0d, "\n"],
  [0x1e, "-"],
])

function doc(streams: Map<string, Uint8Array>) {
  const word = streams.get("/WordDocument")
  const data = word && view(word)
  if (!word || !data || word.length < 0x200 || data.getUint16(0, true) !== 0xa5ec)
    throw new Unreadable("it is not a valid Word 97-2003 document")
  if (data.getUint16(2, true) < 0xc1) throw new Unreadable("Word 6.0/95 and older documents are not supported")
  const flags = data.getUint16(0x0a, true)
  if (flags & 0x100) throw new Unreadable("it is password-protected (encrypted)")
  const tableStream = streams.get(flags & 0x200 ? "/1Table" : "/0Table")
  if (!tableStream) throw new Unreadable("it has no text table; it may be damaged")
  // The FIB's variable-length arrays each follow their own count: FibRgW, FibRgLw, then FibRgFcLcb.
  const longs = 34 + data.getUint16(32, true) * 2 + 2
  const pairs = longs + data.getUint16(longs - 2, true) * 4 + 2
  const characters = data.getUint32(longs + 12, true)
  const clxStart = data.getUint32(pairs + 33 * 8, true)
  const clx = tableStream.subarray(clxStart, clxStart + data.getUint32(pairs + 33 * 8 + 4, true))
  const clxData = view(clx)
  let position = 0
  while (clx[position] === 0x01) position += 3 + clxData.getInt16(position + 1, true)
  if (clx[position] !== 0x02) throw new Unreadable("its text table is damaged")
  const plc = clx.subarray(position + 5, position + 5 + clxData.getUint32(position + 1, true))
  const plcData = view(plc)
  const count = Math.floor((plc.length - 4) / 12)
  const pieces: string[] = []
  for (let index = 0, remaining = characters; index < count && remaining > 0; index++) {
    const length = Math.min(plcData.getUint32((index + 1) * 4, true) - plcData.getUint32(index * 4, true), remaining)
    const location = plcData.getUint32((count + 1) * 4 + index * 8 + 2, true)
    const offset = location & 0x3fffffff
    // Compressed pieces store one Windows-1252 byte per character at half the recorded offset.
    pieces.push(
      location & 0x40000000
        ? WINDOWS_1252.decode(word.subarray(offset / 2, offset / 2 + length))
        : UTF16.decode(word.subarray(offset, offset + length * 2)),
    )
    remaining -= length
  }
  return lines([wordText(pieces.join(""))])
}

// Fields keep their result and drop their instructions; a cell ends with 0x07 and a row with one more.
function wordText(content: string) {
  const fields: boolean[] = []
  const output: string[] = []
  for (const character of content) {
    const code = character.charCodeAt(0)
    if (code === 0x13) fields.push(false)
    if (code === 0x14 && fields.length > 0) fields[fields.length - 1] = true
    if (code === 0x15) fields.pop()
    if (code === 0x13 || code === 0x14 || code === 0x15 || fields.includes(false)) continue
    output.push(code === 0x07 || code === 0x09 || code >= 0x20 ? character : (WORD_CHARACTERS.get(code) ?? ""))
  }
  return output
    .join("")
    .replace(/\x07\x07/g, "\n")
    .replace(/\x07/g, "\t")
}

// PowerPoint 97-2003: the current user's edit chain maps persist IDs to the slide records in slide order.

const PPT_TEXT_CHARS = 0x0fa0
const PPT_TEXT_BYTES = 0x0fa8

function ppt(streams: Map<string, Uint8Array>) {
  const stream = streams.get("/PowerPoint Document")
  if (!stream) throw new Unreadable("it is not a valid PowerPoint 97-2003 presentation")
  const user = streams.get("/Current User")
  const userData = user && user.length >= 20 ? view(user) : undefined
  if (userData && userData.getUint32(12, true) === 0xf3d1c4df)
    throw new Unreadable("it is password-protected (encrypted)")
  const slides = userData ? pptSlides(stream, userData.getUint32(16, true)) : undefined
  // Without a usable edit chain, every text record in stream order still reads.
  return slides ?? lines(pptTexts(stream, 0, stream.length).map((text) => text.text))
}

function pptSlides(stream: Uint8Array, edit: number) {
  const data = view(stream)
  const type = (offset: number) => (offset + 8 <= stream.length ? data.getUint16(offset + 2, true) : undefined)
  const edits: number[] = []
  for (let offset = edit; offset > 0 && !edits.includes(offset); offset = data.getUint32(offset + 16, true)) {
    if (type(offset) !== 0x0ff5 || offset + 32 > stream.length) return
    edits.push(offset)
  }
  if (edits.length === 0) return
  // Later edits override earlier ones, so directories apply from the oldest edit.
  const persist = new Map<number, number>()
  for (const offset of edits.toReversed()) {
    const directory = data.getUint32(offset + 20, true)
    if (type(directory) !== 0x1772) return
    const end = Math.min(directory + 8 + data.getUint32(directory + 4, true), stream.length)
    for (let position = directory + 8; position + 4 <= end; ) {
      const entry = data.getUint32(position, true)
      for (let index = 0; index < entry >>> 20 && position + 8 + index * 4 <= end; index++)
        persist.set((entry & 0xfffff) + index, data.getUint32(position + 4 + index * 4, true))
      position += 4 + (entry >>> 20) * 4
    }
  }
  const documentOffset = persist.get(data.getUint32(edits[0] + 24, true))
  if (documentOffset === undefined || type(documentOffset) !== 0x03e8) return
  const lists = pptChildren(stream, documentOffset).filter((child) => child.type === 0x0ff0)
  const notes = new Map(
    pptChildren(stream, lists.find((list) => list.instance === 2)?.offset)
      .filter((child) => child.type === 0x03f3)
      .map((child) => [data.getUint32(child.start + 12, true), data.getUint32(child.start, true)] as const),
  )
  // The slide list holds one SlidePersistAtom per slide in order, each followed by that slide's outline text.
  const list = lists.find((item) => item.instance === 0)
  const listEnd = list === undefined ? 0 : list.end
  const atoms = pptChildren(stream, list?.offset).filter((child) => child.type === 0x03f3)
  return atoms
    .map((atom, index) => {
      const offset = persist.get(data.getUint32(atom.start, true))
      // The slide's SlideAtom names its notes by notes ID, which the notes list maps to a persist ID.
      const slideAtom = pptChildren(stream, offset).find((child) => child.type === 0x03ef)
      const notesID =
        slideAtom && slideAtom.end - slideAtom.start >= 20 ? data.getUint32(slideAtom.start + 16, true) : 0
      const notesOffset = persist.get(notes.get(notesID) ?? -1)
      // Placeholder text lives in the slide list or the slide's drawing, which may repeat it.
      const texts = [
        ...pptTexts(stream, atom.end, atoms[index + 1]?.offset ?? listEnd),
        ...(offset === undefined ? [] : pptTexts(stream, offset, pptEnd(stream, offset))),
      ]
      const title = texts.find(pptTitle)?.text
      const body = new Set(texts.map((text) => text.text))
      if (title !== undefined) body.delete(title)
      const notesTexts = notesOffset === undefined ? [] : pptTexts(stream, notesOffset, pptEnd(stream, notesOffset))
      return [
        `## Slide ${index + 1}${title ? `: ${title.replace(/\n/g, " ")}` : ""}`,
        ...body,
        ...(notesTexts.length === 0 ? [] : ["### Notes", ...notesTexts.map((text) => text.text)]),
      ].join("\n")
    })
    .join("\n\n")
}

function pptEnd(stream: Uint8Array, offset: number) {
  return Math.min(offset + 8 + view(stream).getUint32(offset + 4, true), stream.length)
}

// The direct children of the container record at `offset`.
function pptChildren(stream: Uint8Array, offset: number | undefined) {
  if (offset === undefined || offset + 8 > stream.length) return []
  const data = view(stream)
  const children: { type: number; instance: number; offset: number; start: number; end: number }[] = []
  for (let position = offset + 8, end = pptEnd(stream, offset); position + 8 <= end; ) {
    const next = Math.min(position + 8 + data.getUint32(position + 4, true), end)
    children.push({
      type: data.getUint16(position + 2, true),
      instance: data.getUint16(position, true) >>> 4,
      offset: position,
      start: position + 8,
      end: next,
    })
    position = next
  }
  return children
}

// Text records anywhere in [start, end), descending into containers, whose version nibble is 0xF. Each carries
// the placeholder type of the TextHeaderAtom before it, where 0 and 6 are titles.
function pptTexts(stream: Uint8Array, start: number, end: number): { text: string; kind?: number }[] {
  const data = view(stream)
  const texts: { text: string; kind?: number }[] = []
  let kind: number | undefined
  for (let position = start; position + 8 <= end; ) {
    const type = data.getUint16(position + 2, true)
    const next = Math.min(position + 8 + data.getUint32(position + 4, true), end)
    if ((data.getUint16(position, true) & 0xf) === 0xf) texts.push(...pptTexts(stream, position + 8, next))
    if (type === 0x0f9f && next - position >= 12) kind = data.getUint32(position + 8, true)
    if (type === PPT_TEXT_CHARS || type === PPT_TEXT_BYTES) {
      const text = (type === PPT_TEXT_CHARS ? UTF16 : WINDOWS_1252)
        .decode(stream.subarray(position + 8, next))
        .replace(/[\r\v]/g, "\n")
        .trim()
      // "*" is the stored text of slide-number fields.
      if (text && text !== "*") texts.push({ text, kind })
    }
    position = next
  }
  return texts
}

const pptTitle = (text: { kind?: number }) => text.kind === 0 || text.kind === 6

// ZIP

type Zip = { readonly names: string[]; readonly xml: (name: string) => Promise<Element | undefined> }

function zip(bytes: Uint8Array): Zip {
  const data = view(bytes)
  // The end-of-central-directory record sits within the last 64 KiB plus its own 22 bytes.
  let end = -1
  for (let position = bytes.length - 22; position >= Math.max(0, bytes.length - 22 - 0xffff); position--)
    if (data.getUint32(position, true) === 0x06054b50) {
      end = position
      break
    }
  if (end < 0) throw new Unreadable("it is not a valid ZIP-based document; it may be damaged")
  const entries = new Map<string, { method: number; flags: number; size: number; expanded: number; local: number }>()
  for (let index = 0, position = data.getUint32(end + 16, true); index < data.getUint16(end + 10, true); index++) {
    if (position + 46 > bytes.length || data.getUint32(position, true) !== 0x02014b50) break
    const nameLength = data.getUint16(position + 28, true)
    entries.set(UTF8.decode(bytes.subarray(position + 46, position + 46 + nameLength)), {
      flags: data.getUint16(position + 8, true),
      method: data.getUint16(position + 10, true),
      size: data.getUint32(position + 20, true),
      expanded: data.getUint32(position + 24, true),
      local: data.getUint32(position + 42, true),
    })
    position += 46 + nameLength + data.getUint16(position + 30, true) + data.getUint16(position + 32, true)
  }
  const read = async (name: string) => {
    const entry = entries.get(name)
    if (!entry) return
    if (entry.flags & 1) throw new Unreadable("it is password-protected (encrypted)")
    const start = entry.local + 30 + data.getUint16(entry.local + 26, true) + data.getUint16(entry.local + 28, true)
    const content = bytes.subarray(start, start + entry.size)
    if (entry.method === 0) return content
    if (entry.method === 8) return inflate(content, entry.expanded)
    throw new Unreadable(`it uses an unsupported compression method (${entry.method})`)
  }
  return {
    names: [...entries.keys()],
    xml: async (name) => {
      const content = await read(name)
      return content && parseXml(UTF8.decode(content))
    },
  }
}

// Raw DEFLATE through SheetJS's JavaScript inflater, which stops at the end of the stream as zlib does: Hancom writes
// some HWP sections with bytes after it, and web decompression streams reject those bytes along with the output.
// `size` is the size a ZIP entry declares, checked before inflating; the inflater grows its output as it goes.
async function inflate(bytes: Uint8Array, size?: number) {
  const limit = () =>
    new Unreadable(`a part of it expands past the ${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB document limit`)
  if (size !== undefined && size > MAX_DOCUMENT_BYTES) throw limit()
  const { CFB } = await import("xlsx")
  // `_inflateRaw` is exported but untyped. It records how far it read on its input, so it gets a fresh view, and a
  // size of 0 lets it grow its output, where a size would cap the output at that size.
  const output: ArrayLike<number> = CFB.utils._inflateRaw(bytes.subarray(), 0)
  if (output.length > MAX_DOCUMENT_BYTES) throw limit()
  return output instanceof Uint8Array ? output : Uint8Array.from(output)
}

// XML

type Element = { readonly name: string; readonly attributes: Record<string, string>; readonly children: Node[] }
type Node = Element | string
const EMPTY: Element = { name: "", attributes: {}, children: [] }

function parseXml(content: string) {
  const root: Element = { name: "", attributes: {}, children: [] }
  const stack = [root]
  const parser = new Parser(
    {
      onopentag: (name, attributes) => {
        const element = { name, attributes, children: [] }
        stack[stack.length - 1].children.push(element)
        stack.push(element)
      },
      ontext: (value) => void stack[stack.length - 1].children.push(value),
      onclosetag: () => void (stack.length > 1 && stack.pop()),
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.end(content)
  return root
}

// Child elements along a path of names: `elements(root, "a:tbl", "a:tr")` is every row of a root table.
function elements(node: Element, ...names: string[]): Element[] {
  return names.reduce<Element[]>(
    (current, name) =>
      current.flatMap((parent) =>
        parent.children.filter((child): child is Element => typeof child !== "string" && child.name === name),
      ),
    [node],
  )
}

function first(node: Element | undefined, ...names: string[]) {
  return node && elements(node, ...names)[0]
}

function descendants(node: Element, name: string): Element[] {
  return node.children.flatMap((child) =>
    typeof child === "string" ? [] : child.name === name ? [child] : descendants(child, name),
  )
}

type Inline = {
  readonly text: Set<string>
  readonly breaks: Record<string, string>
  readonly skip: Set<string>
  readonly paragraph: string
}

// A paragraph's visible text: character data inside text elements, break elements, and nested paragraphs
// (as in text boxes) on lines of their own.
function inline(node: Element, rules: Inline, inText = false): string {
  return node.children
    .map((child) => {
      if (typeof child === "string") return inText ? child : ""
      if (rules.skip.has(child.name)) return ""
      if (child.name in rules.breaks) return rules.breaks[child.name]
      if (child.name === rules.paragraph) return `\n${inline(child, rules)}`
      return inline(child, rules, inText || rules.text.has(child.name))
    })
    .join("")
}

// Output

// Layout tables without text, common in Hangul forms, are left out.
function table(rows: string[][]) {
  const width = Math.max(0, ...rows.map((row) => row.length))
  if (rows.every((row) => row.every((cell) => !cell?.trim()))) return ""
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) =>
      (cells[index] ?? "")
        .trim()
        .replace(/\|/g, "\\|")
        .replace(/\s*\n\s*/g, "<br>"),
    ).join(" | ")} |`
  return [line(rows[0]), line(Array<string>(width).fill("---")), ...rows.slice(1).map(line)].join("\n")
}

// Blocks joined one per line, with runs of blank lines collapsed to one.
function lines(blocks: string[]) {
  return blocks
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Bytes

const UTF8 = new TextDecoder()
const UTF16 = new TextDecoder("utf-16le")
const WINDOWS_1252 = new TextDecoder("windows-1252")

// Little-endian reads over the bytes, which may be a view into a larger buffer.
function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value)
}
