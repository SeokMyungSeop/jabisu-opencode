import { describe, expect, test } from "bun:test"
import path from "path"
import { deflateRawSync } from "zlib"
import { Environment } from "@opencode/core/environment/index"
import { AbsolutePath } from "@opencode/core/schema"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { ReadDocument } from "@opencode/core/tool/read-document"
import { DocumentText } from "@opencode/util/document-text"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, FileSystem } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { CFB, utils, write } from "xlsx"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem])))

// Writes the document and reads it through the read tool's filesystem reader.
const readDocument = (
  name: string,
  bytes: Uint8Array,
  options?: ReadToolFileSystem.ReadOptions,
  page: ReadToolFileSystem.PageInput = {},
) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const directory = yield* files.makeTempDirectoryScoped()
    const file = path.join(directory, name)
    yield* files.writeFile(file, bytes)
    return yield* ReadToolFileSystem.read(
      Environment.makeFiles(Environment.makeLocalDriver(spawner)),
      AbsolutePath.make(file),
      name,
      page,
      options,
    )
  })

describe("ReadTool documents", () => {
  it.live("reads a Word document's headings, lists and tables", () =>
    Effect.gen(function* () {
      const result = yield* readDocument(
        "report.docx",
        zip({
          "word/styles.xml": xml(
            `<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
              <w:style w:styleId="ListBullet2"><w:name w:val="List Bullet 2"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>`,
          ),
          "word/document.xml": xml(
            `<w:document ${W}><w:body>
              <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>업무 보고</w:t></w:r></w:p>
              <w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>
                <w:r><w:t xml:space="preserve">탭 </w:t></w:r><w:r><w:tab/><w:t>구분</w:t></w:r>
                <w:del><w:r><w:delText>지운 글</w:delText></w:r></w:del>
                <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r>
                <w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r></w:p>
              <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>목록</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="ListBullet2"/></w:pPr><w:r><w:t>스타일 목록</w:t></w:r></w:p>
              <w:p><w:pPr><w:pStyle w:val="ListBullet2"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>번호 끔</w:t></w:r></w:p>
              <w:tbl>
                <w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>담당</w:t></w:r></w:p></w:tc></w:tr>
                <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>첫 줄</w:t></w:r></w:p><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc></w:tr>
              </w:tbl>
              <w:sectPr/>
            </w:body></w:document>`,
          ),
        }),
      )

      expect(result).toMatchObject({
        type: "text-page",
        document: "Word document",
        content: [
          "# 업무 보고",
          "탭 \t구분1",
          "  - 목록",
          "  - 스타일 목록",
          "번호 끔",
          "| 항목 | 담당 |",
          "| --- | --- |",
          "| 첫 줄<br>a\\|b |  |",
        ].join("\n"),
        truncated: false,
      })
    }),
  )

  it.live("reads a presentation's slides in order with titles, tables and notes", () =>
    Effect.gen(function* () {
      const result = yield* readDocument(
        "deck.pptx",
        zip({
          "ppt/presentation.xml": xml(
            `<p:presentation ${P}><p:sldIdLst><p:sldId r:id="rId3"/><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>`,
          ),
          "ppt/_rels/presentation.xml.rels": rels({ rId2: "slides/slide1.xml", rId3: "slides/slide2.xml" }),
          "ppt/slides/slide1.xml": xml(
            `<p:sld ${P}><p:cSld><p:spTree>${shape("title", "둘째 장")}${shape(undefined, "본문")}</p:spTree></p:cSld></p:sld>`,
          ),
          "ppt/slides/slide2.xml": xml(
            `<p:sld ${P}><p:cSld><p:spTree>${shape("ctrTitle", "첫 장")}
              <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
                <a:tr><a:tc gridSpan="2"><a:txBody><a:p><a:r><a:t>합친 칸</a:t></a:r></a:p></a:txBody></a:tc><a:tc hMerge="1"><a:txBody><a:p><a:r><a:t>합친 칸</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
              </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
            </p:spTree></p:cSld></p:sld>`,
          ),
          "ppt/slides/_rels/slide2.xml.rels": rels({ rId1: "../notesSlides/notesSlide1.xml" }, "notesSlide"),
          "ppt/notesSlides/notesSlide1.xml": xml(
            `<p:notes ${P}><p:cSld><p:spTree>${shape("sldImg", "")}${shape("body", "발표 메모")}</p:spTree></p:cSld></p:notes>`,
          ),
        }),
      )

      expect(result).toMatchObject({
        document: "PowerPoint presentation",
        content: [
          "## Slide 1: 첫 장",
          "| 합친 칸 |  |",
          "| --- | --- |",
          "### Notes",
          "발표 메모",
          "",
          "## Slide 2: 둘째 장",
          "본문",
        ].join("\n"),
      })
    }),
  )

  it.live("reads an HWPX document's sections, tables by cell address and text boxes", () =>
    Effect.gen(function* () {
      const section = (body: string) => xml(`<hs:sec ${HP}>${body}</hs:sec>`)
      const result = yield* readDocument(
        "공문.hwpx",
        zip({
          mimetype: "application/hwp+zip",
          "Contents/section1.xml": section(`<hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p>`),
          "Contents/section0.xml": section(
            `<hp:p><hp:run><hp:secPr/><hp:t>제목<hp:tab/>본문<hp:lineBreak/>다음 줄</hp:t></hp:run></hp:p>
            <hp:p><hp:run><hp:tbl>
              <hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>항목</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/></hp:tc>
                <hp:tc><hp:subList><hp:p><hp:run><hp:t>담당</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="2" rowAddr="0"/></hp:tc></hp:tr>
            </hp:tbl><hp:t>표 뒤</hp:t></hp:run></hp:p>
            <hp:p><hp:run><hp:rect><hp:drawText><hp:subList><hp:p><hp:run><hp:t>글상자</hp:t></hp:run></hp:p></hp:subList></hp:drawText></hp:rect></hp:run></hp:p>
            <hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p/></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>`,
          ),
        }),
      )

      expect(result).toMatchObject({
        document: "HWPX document",
        content: [
          "제목 본문",
          "다음 줄",
          "",
          "표 뒤",
          "",
          "| 항목 |  | 담당 |",
          "| --- | --- | --- |",
          "",
          "글상자",
          "",
          "둘째 구역",
        ].join("\n"),
      })
    }),
  )

  it.live("reads an HWP document's paragraphs, controls and tables", () =>
    Effect.gen(function* () {
      const result = yield* readDocument("공문.hwp", hwp(1))

      expect(result).toMatchObject({
        document: "HWP document",
        content: ["보고서", "", "| 항목 | 담당 |", "| --- | --- |", "", "가\t나"].join("\n"),
      })
    }),
  )

  it.live("reports a distribution HWP document instead of reading its encrypted text", () =>
    Effect.gen(function* () {
      const error = yield* readDocument("배포.hwp", hwp(0b101)).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.DocumentError)
      expect(error.message).toBe(
        "Cannot read 배포.hwp: it is a distribution document (배포용 문서), whose text HWP encrypts",
      )
    }),
  )

  it.live("reads a Word 97-2003 document through its piece table", () =>
    Effect.gen(function* () {
      const result = yield* readDocument("old.doc", doc())

      expect(result).toMatchObject({
        document: "Word 97-2003 document",
        content: ["제목", "항목\t담당", "링크 Done"].join("\n"),
      })
    }),
  )

  it.live("reads a PowerPoint 97-2003 presentation through its persist directory", () =>
    Effect.gen(function* () {
      const result = yield* readDocument("old.ppt", ppt())

      expect(result).toMatchObject({
        document: "PowerPoint 97-2003 presentation",
        content: ["## Slide 1: 자비수 소개", "본문 줄", "둘째 줄", "글상자", "### Notes", "발표자 메모"].join("\n"),
      })
    }),
  )

  it.live("reads workbooks in both Excel formats", () =>
    Effect.gen(function* () {
      const workbook = utils.book_new()
      utils.book_append_sheet(
        workbook,
        utils.aoa_to_sheet([
          ["항목", "금액"],
          ["인건비", 1500000],
        ]),
        "예산",
      )
      utils.book_append_sheet(workbook, utils.aoa_to_sheet([]), "빈 시트")
      const expected = ["## Sheet: 예산", "항목,금액", "인건비,1500000", "", "## Sheet: 빈 시트", "(empty)"].join("\n")

      for (const bookType of ["xlsx", "biff8"] as const) {
        const result = yield* readDocument(
          bookType === "xlsx" ? "budget.xlsx" : "budget.xls",
          write(workbook, { type: "buffer", bookType }),
        )
        expect(result).toMatchObject({ document: "spreadsheet", content: expected })
      }
    }),
  )

  it.live("pages a converted document like a text file", () =>
    Effect.gen(function* () {
      const paragraphs = Array.from({ length: 5 }, (_, index) => `<w:p><w:r><w:t>줄 ${index + 1}</w:t></w:r></w:p>`)
      const result = yield* readDocument(
        "long.docx",
        zip({ "word/document.xml": xml(`<w:document ${W}><w:body>${paragraphs.join("")}</w:body></w:document>`) }),
        undefined,
        { offset: 2, limit: 2 },
      )

      expect(result).toMatchObject({ content: "줄 2\n줄 3", offset: 2, truncated: true, next: 4 })
    }),
  )

  it.live("reports an encrypted Office document", () =>
    Effect.gen(function* () {
      const container = CFB.utils.cfb_new()
      CFB.utils.cfb_add(container, "/EncryptedPackage", Buffer.from("secret"))
      const error = yield* readDocument("locked.docx", CFB.write(container, { type: "buffer" })).pipe(Effect.flip)

      expect(error.message).toBe("Cannot read locked.docx: it is password-protected (encrypted)")
    }),
  )

  it.live("reads a PDF as text only when asked", () =>
    Effect.gen(function* () {
      const media = yield* readDocument("notice.pdf", PDF, { pdfAsText: Effect.succeed(false) })
      const text = yield* readDocument("notice.pdf", PDF, { pdfAsText: Effect.succeed(true) })

      expect(media).toMatchObject({ type: "file", encoding: "base64", mime: "application/pdf" })
      expect(text).toMatchObject({ type: "text-page", document: "PDF", content: "## Page 1\nHello PDF" })
    }),
  )

  it.live("leaves other ZIP files to the binary check", () =>
    Effect.gen(function* () {
      const error = yield* readDocument("bundle.zip", zip({ "a.txt": "a" })).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ReadToolFileSystem.BinaryFileError)
    }),
  )
})

describe("ReadDocument text to search", () => {
  test("names the PDF pages without text, such as a scanned page with only its number", async () => {
    const page = (content: string, id: number) => [
      `${id} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents ${id + 1} 0 R /Resources << /Font << /F1 9 0 R >> >> >> endobj`,
      `${id + 1} 0 obj << /Length ${content.length} >> stream`,
      content,
      "endstream endobj",
    ]
    const pdf = Buffer.from(
      [
        "%PDF-1.4",
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >> endobj",
        ...page(PDF_TEXT, 3),
        ...page("BT /F1 10 Tf 140 10 Td (2) Tj ET", 5),
        "9 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        "trailer << /Root 1 0 R >>",
        "%%EOF",
      ].join("\n"),
    )
    const converted = await ReadDocument.convert("pdf", pdf)

    expect(converted.blank).toEqual([2])
    expect(converted.text).toContain("Hello PDF")
    expect(converted.text).toContain("(no text on this page; it may be a scanned image)")
  })

  test("finds no text in a document of pictures only, but keeps a short one with words", async () => {
    const word = (body: string) =>
      zip({ "word/document.xml": xml(`<w:document ${W}><w:body>${body}</w:body></w:document>`) })

    expect(ReadDocument.convert("docx", word("<w:p><w:r><w:drawing/></w:r></w:p>"))).rejects.toBeInstanceOf(
      DocumentText.Unreadable,
    )
    expect((await ReadDocument.convert("docx", word("<w:p><w:r><w:t>확인</w:t></w:r></w:p>"))).text).toBe("확인")
  })
})

const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
const P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
const HP = `xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"`

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`

const rels = (targets: Record<string, string>, type = "slide") =>
  xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(targets)
      .map(
        ([id, target]) =>
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`,
      )
      .join("")}</Relationships>`,
  )

const shape = (placeholder: string | undefined, text: string) =>
  `<p:sp><p:nvSpPr><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`

// A ZIP archive of deflated entries, as Office and Hancom write them.
function zip(entries: Record<string, string>) {
  const records = Object.entries(entries).map(([name, content]) => ({
    name: Buffer.from(name),
    data: deflateRawSync(Buffer.from(content)),
    size: Buffer.byteLength(content),
  }))
  const locals = records.map((entry) => {
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(entry.data.length, 18)
    header.writeUInt32LE(entry.size, 22)
    header.writeUInt16LE(entry.name.length, 26)
    return Buffer.concat([header, entry.name, entry.data])
  })
  const offsets = locals.map((_, index) => locals.slice(0, index).reduce((total, local) => total + local.length, 0))
  const central = Buffer.concat(
    records.map((entry, index) => {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(8, 10)
      header.writeUInt32LE(entry.data.length, 20)
      header.writeUInt32LE(entry.size, 24)
      header.writeUInt16LE(entry.name.length, 28)
      header.writeUInt32LE(offsets[index], 42)
      return Buffer.concat([header, entry.name])
    }),
  )
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(records.length, 8)
  end.writeUInt16LE(records.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(
    locals.reduce((total, local) => total + local.length, 0),
    16,
  )
  return Buffer.concat([...locals, central, end])
}

function compound(streams: Record<string, Buffer>) {
  const container = CFB.utils.cfb_new()
  for (const [name, content] of Object.entries(streams)) CFB.utils.cfb_add(container, name, content)
  const file: Buffer = CFB.write(container, { type: "buffer" })
  return file
}

const utf16 = (text: string) => Buffer.from(text, "utf16le")
const u16 = (...values: number[]) => Buffer.from(Uint16Array.from(values).buffer)
const u32 = (...values: number[]) => Buffer.from(Uint32Array.from(values).buffer)

// HWP 5.0 with a paragraph, a paragraph anchoring a one-row table, and a paragraph with an inline tab control.
function hwp(flags: number) {
  const record = (tag: number, level: number, body: Buffer) =>
    Buffer.concat([u32(tag | (level << 10) | (body.length << 20)), body])
  const control = (code: number) => u16(code, 0, 0, 0, 0, 0, 0, code)
  const paragraph = (level: number, text: Buffer) =>
    Buffer.concat([record(0x42, level, Buffer.alloc(22)), record(0x43, level + 1, Buffer.concat([text, u16(13)]))])
  const cell = (column: number, text: string) =>
    Buffer.concat([
      record(0x48, 2, Buffer.concat([u16(1, 0, 32, 0, column, 0, 1, 1), Buffer.alloc(16)])),
      paragraph(2, utf16(text)),
    ])
  const section = Buffer.concat([
    paragraph(0, utf16("보고서")),
    paragraph(0, control(11)),
    record(0x47, 1, Buffer.from(" lbt", "latin1")),
    record(0x4d, 2, Buffer.concat([u32(0), u16(1, 2)])),
    cell(0, "항목"),
    cell(1, "담당"),
    paragraph(0, Buffer.concat([utf16("가"), control(9), utf16("나")])),
  ])
  const header = Buffer.alloc(256)
  header.write("HWP Document File", "latin1")
  header.writeUInt32LE(0x05000300, 32)
  header.writeUInt32LE(flags, 36)
  return compound({ "/FileHeader": header, "/BodyText/Section0": flags & 1 ? deflateRawSync(section) : section })
}

// Word 97-2003 with a Unicode piece holding a field and a table row, and a compressed Windows-1252 piece.
function doc() {
  const unicode = utf16("제목\r항목\x07담당\x07\x07\x13 HYPERLINK x \x14링크\x15 ")
  const compressed = Buffer.from("Done\r", "latin1")
  const textStart = 0x400
  const word = Buffer.alloc(textStart + unicode.length + compressed.length)
  word.writeUInt16LE(0xa5ec, 0)
  word.writeUInt16LE(0xc1, 2)
  word.writeUInt16LE(14, 32)
  word.writeUInt16LE(22, 62)
  word.writeUInt32LE(unicode.length / 2 + compressed.length, 64 + 12)
  word.writeUInt16LE(93, 152)
  unicode.copy(word, textStart)
  compressed.copy(word, textStart + unicode.length)
  const pieces = [
    { characters: unicode.length / 2, location: textStart },
    { characters: compressed.length, location: ((textStart + unicode.length) * 2) | 0x40000000 },
  ]
  const plc = Buffer.concat([
    u32(0, pieces[0].characters, pieces[0].characters + pieces[1].characters),
    ...pieces.map((piece) => Buffer.concat([u16(0), u32(piece.location), u16(0)])),
  ])
  const clx = Buffer.concat([Buffer.from([0x02]), u32(plc.length), plc])
  word.writeUInt32LE(0, 154 + 33 * 8)
  word.writeUInt32LE(clx.length, 154 + 33 * 8 + 4)
  return compound({ "/WordDocument": word, "/0Table": clx })
}

// PowerPoint 97-2003: a document whose slide list holds one titled slide, the slide's drawing with a text
// box, its notes, and the persist directory and edit that locate them.
function ppt() {
  const atom = (type: number, data: Buffer, instance = 0) =>
    Buffer.concat([u16(instance << 4), u16(type), u32(data.length), data])
  const container = (type: number, children: Buffer[], instance = 0) =>
    Buffer.concat([
      u16(0xf | (instance << 4)),
      u16(type),
      u32(children.reduce((n, child) => n + child.length, 0)),
      ...children,
    ])
  const text = (kind: number, value: string) => [atom(0x0f9f, u32(kind)), atom(0x0fa0, utf16(value))]
  const documentRecord = container(0x03e8, [
    container(
      0x0ff0,
      [atom(0x03f3, u32(2, 0, 0, 256, 0)), ...text(0, "자비수 소개"), ...text(1, "본문 줄\r둘째 줄")],
      0,
    ),
    container(0x0ff0, [atom(0x03f3, u32(3, 0, 0, 0x100, 0))], 2),
  ])
  const slide = container(0x03ee, [
    atom(0x03ef, Buffer.concat([u32(0, 0, 0, 0, 0x100), u16(0, 0)])),
    container(0xf002, [container(0xf00d, text(4, "글상자"))]),
  ])
  const notes = container(0x03f0, [container(0xf002, [atom(0x0fa0, utf16("발표자 메모")), atom(0x0fa0, utf16("*"))])])
  const directoryOffset = documentRecord.length + slide.length + notes.length
  const directory = atom(0x1772, u32(1 | (3 << 20), 0, documentRecord.length, documentRecord.length + slide.length))
  const edit = atom(0x0ff5, Buffer.concat([u32(0), u16(0), Buffer.from([0, 3]), u32(0, directoryOffset, 1, 4, 1)]))
  const stream = Buffer.concat([documentRecord, slide, notes, directory, edit])
  const user = Buffer.concat([u16(0), u16(0x0ff6), u32(20), u32(20, 0xe391c05f, directoryOffset + directory.length)])
  return compound({ "/PowerPoint Document": stream, "/Current User": user })
}

const PDF_TEXT = "BT /F1 18 Tf 20 100 Td (Hello PDF) Tj ET"
const PDF = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${PDF_TEXT.length} >> stream`,
    PDF_TEXT,
    "endstream endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n"),
)
