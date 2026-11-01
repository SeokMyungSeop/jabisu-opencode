export * as AmendmentHwpx from "./amendment-hwpx.js"

import type { LawAmendment } from "./amendment.js"

// A 신·구조문대비표 as a Hangul (HWPX) document: the title lines, then a two-column table whose heading row repeats on
// every page, horizontal rules only between articles, and the changed words truly underlined. HWPX is a ZIP of XML
// parts; the parts here are the few Hangul needs, written by hand, and the ZIP stores them uncompressed.

const HEAD = "http://www.hancom.co.kr/hwpml/2011/head"
const PARAGRAPH = "http://www.hancom.co.kr/hwpml/2011/paragraph"
const SECTION = "http://www.hancom.co.kr/hwpml/2011/section"
const CORE = "http://www.hancom.co.kr/hwpml/2011/core"

// Sizes in HWPUNIT, 7200 to the inch: A4 portrait, 25 mm at the sides and 16 mm above and below.
const MM = 7200 / 25.4
const PAGE = {
  width: 59528,
  height: 84188,
  side: Math.round(25 * MM),
  top: Math.round(16 * MM),
  bottom: Math.round(16 * MM),
  header: Math.round(12.7 * MM),
}
const COLUMN = Math.floor((PAGE.width - 2 * PAGE.side) / 2)

const FONT = "함초롬바탕"
const BODY_SIZE = 1200
const TITLE_SIZE = 1600

const CHAR = { body: 0, underline: 1, title: 2 } as const
const PARA = { normal: 0, center: 1, level: 2 } as const
// Cell borders: sides always, a rule above an article's first row and below its last.
const BORDER = { none: 1, box: 2, top: 3, sides: 4, bottom: 5 } as const

// Where a line starts and where its wrapped lines continue, by level: 조 and its text, 항, 호, 목, 1), 가).
const INDENT = [
  { start: 0, wrap: 0 },
  { start: 0, wrap: BODY_SIZE },
  { start: BODY_SIZE, wrap: BODY_SIZE * 2.5 },
  { start: BODY_SIZE * 2, wrap: BODY_SIZE * 3.5 },
  { start: BODY_SIZE * 3, wrap: BODY_SIZE * 4.5 },
  { start: BODY_SIZE * 4, wrap: BODY_SIZE * 5.5 },
]

// Characters XML 1.0 cannot hold, which keep Hangul from opening the document, go; the rest is escaped.
const escape = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"]
const each = (value: number | string) =>
  `hangul="${value}" latin="${value}" hanja="${value}" japanese="${value}" other="${value}" symbol="${value}" user="${value}"`

const border = (id: number, sides: { top: boolean; bottom: boolean; left: boolean; right: boolean }) => {
  const line = (name: string, on: boolean) =>
    `<hh:${name} type="${on ? "SOLID" : "NONE"}" width="0.12 mm" color="#000000"/>`

  return `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>${line("leftBorder", sides.left)}${line("rightBorder", sides.right)}${line("topBorder", sides.top)}${line("bottomBorder", sides.bottom)}<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>`
}

const charPr = (id: number, size: number, style: { bold?: boolean; underline?: boolean }) =>
  `<hh:charPr id="${id}" height="${size}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${BORDER.none}"><hh:fontRef ${each(0)}/><hh:ratio ${each(100)}/><hh:spacing ${each(0)}/><hh:relSz ${each(100)}/><hh:offset ${each(0)}/>${style.bold ? "<hh:bold/>" : ""}<hh:underline type="${style.underline ? "BOTTOM" : "NONE"}" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>`

const paraPr = (id: number, align: "JUSTIFY" | "CENTER" | "LEFT", indent: { start: number; wrap: number }) => {
  const margin = `<hh:margin><hc:intent value="${Math.round(indent.start - indent.wrap)}" unit="HWPUNIT"/><hc:left value="${Math.round(indent.wrap)}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>`

  return `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR"><hh:align horizontal="${align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hp:case><hp:default>${margin}</hp:default></hp:switch><hh:border borderFillIDRef="${BORDER.none}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`
}

function header() {
  const fonts = LANGS.map(
    (lang) =>
      `<hh:fontface lang="${lang}" fontCnt="1"><hh:font id="0" face="${FONT}" type="TTF" isEmbedded="0"/></hh:fontface>`,
  )
  const borders = [
    border(BORDER.none, { top: false, bottom: false, left: false, right: false }),
    border(BORDER.box, { top: true, bottom: true, left: true, right: true }),
    border(BORDER.top, { top: true, bottom: false, left: true, right: true }),
    border(BORDER.sides, { top: false, bottom: false, left: true, right: true }),
    border(BORDER.bottom, { top: false, bottom: true, left: true, right: true }),
  ]
  const chars = [
    charPr(CHAR.body, BODY_SIZE, {}),
    charPr(CHAR.underline, BODY_SIZE, { underline: true }),
    charPr(CHAR.title, TITLE_SIZE, { bold: true }),
  ]
  const paras = [
    paraPr(PARA.normal, "JUSTIFY", INDENT[0]!),
    paraPr(PARA.center, "CENTER", INDENT[0]!),
    ...INDENT.map((indent, level) => paraPr(PARA.level + level, "LEFT", indent)),
  ]

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hh:head xmlns:hh="${HEAD}" xmlns:hp="${PARAGRAPH}" xmlns:hc="${CORE}" version="1.4" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList><hh:fontfaces itemCnt="${fonts.length}">${fonts.join("")}</hh:fontfaces><hh:borderFills itemCnt="${borders.length}">${borders.join("")}</hh:borderFills><hh:charProperties itemCnt="${chars.length}">${chars.join("")}</hh:charProperties><hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties><hh:numberings itemCnt="1"><hh:numbering id="1" start="0"><hh:paraHead start="1" level="1" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT" charPrIDRef="4294967295" checkable="0">^1.</hh:paraHead></hh:numbering></hh:numberings><hh:paraProperties itemCnt="${paras.length}">${paras.join("")}</hh:paraProperties><hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="${PARA.normal}" charPrIDRef="${CHAR.body}" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles></hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument><hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>`
}

const SECTION_PROPERTIES = `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/><hp:pagePr landscape="WIDELY" width="${PAGE.width}" height="${PAGE.height}" gutterType="LEFT_ONLY"><hp:margin header="${PAGE.header}" footer="${PAGE.header}" gutter="0" left="${PAGE.side}" right="${PAGE.side}" top="${PAGE.top}" bottom="${PAGE.bottom}"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr><hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr><hp:pageBorderFill type="BOTH" borderFillIDRef="${BORDER.none}" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill><hp:pageBorderFill type="EVEN" borderFillIDRef="${BORDER.none}" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill><hp:pageBorderFill type="ODD" borderFillIDRef="${BORDER.none}" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill></hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`

/** The level a line's label puts it at: 0 for 조 and plain text, 1 for 항 and so on down to 5 for 가). */
function levelOf(text: string) {
  const rest = text.replace(/^제\d+조(?:의\d+)?(?:\((?:[^()]|\([^()]*\))*\))?\s*/, "")

  if (rest !== text) return 0
  if (/^[①-⑳㉑-㉟㊱-㊿]/.test(rest)) return 1
  if (/^\d{1,3}(?:의\d{1,2})?\./.test(rest)) return 2
  if (/^[가-하](?:의\d{1,2})?\./.test(rest)) return 3
  if (/^\d{1,3}\)/.test(rest)) return 4
  if (/^[가-하]\)/.test(rest)) return 5

  return 0
}

/** Writes the section, numbering its paragraphs as it goes; every paragraph id in a document is its own. */
function section(titles: readonly string[], articles: readonly (readonly LawAmendment.Row[])[]) {
  let next = 1
  const paragraph = (para: number, runs: string) =>
    `<hp:p id="${next++}" paraPrIDRef="${para}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runs || `<hp:run charPrIDRef="${CHAR.body}"><hp:t/></hp:run>`}</hp:p>`
  const run = (char: number, text: string) => `<hp:run charPrIDRef="${char}"><hp:t>${escape(text)}</hp:t></hp:run>`
  const line = (segments: LawAmendment.Line) =>
    paragraph(
      PARA.level + levelOf(segments.map((segment) => segment.text).join("")),
      segments
        .filter((segment) => segment.text)
        .map((segment) => run(segment.underline ? CHAR.underline : CHAR.body, segment.text))
        .join(""),
    )
  const cell = (column: number, row: number, fill: number, paragraphs: string, heading: boolean) =>
    `<hp:tc name="" header="${heading ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${fill}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${heading ? "CENTER" : "TOP"}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paragraphs}</hp:subList><hp:cellAddr colAddr="${column}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${COLUMN}" height="1000"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`
  const first = paragraph(
    PARA.center,
    `<hp:run charPrIDRef="${CHAR.title}">${SECTION_PROPERTIES}</hp:run>${run(CHAR.title, titles[0] ?? "")}`,
  )
  const rest = titles.slice(1).map((title) => paragraph(PARA.center, run(CHAR.title, title)))
  const space = paragraph(PARA.center, "")
  const rows = [
    `<hp:tr>${cell(0, 0, BORDER.box, paragraph(PARA.center, run(CHAR.body, "현      행")), true)}${cell(1, 0, BORDER.box, paragraph(PARA.center, run(CHAR.body, "개   정   안")), true)}</hp:tr>`,
  ]
  const flat = articles.flatMap((article) =>
    article.map((row, index) => ({ row, first: index === 0, last: index === article.length - 1 })),
  )

  flat.forEach((item, index) => {
    const fill =
      item.first && item.last ? BORDER.box : item.first ? BORDER.top : item.last ? BORDER.bottom : BORDER.sides

    rows.push(
      `<hp:tr>${cell(0, index + 1, fill, item.row.before.map(line).join(""), false)}${cell(1, index + 1, fill, item.row.after.map(line).join(""), false)}</hp:tr>`,
    )
  })
  const table = `<hp:tbl id="${next++}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rows.length}" colCnt="2" cellSpacing="0" borderFillIDRef="${BORDER.none}" noAdjust="0"><hp:sz width="${COLUMN * 2}" widthRelTo="ABSOLUTE" height="${rows.length * 1000}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>${rows.join("")}</hp:tbl>`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hs:sec xmlns:hs="${SECTION}" xmlns:hp="${PARAGRAPH}" xmlns:hc="${CORE}" xmlns:hh="${HEAD}">${first}${rest.join("")}${space}${paragraph(PARA.normal, `<hp:run charPrIDRef="${CHAR.body}">${table}</hp:run>`)}</hs:sec>`
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>`

const content = (title: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" version="" unique-identifier="" id=""><opf:metadata><opf:title>${escape(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">자비수</opf:meta></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`

const VERSION = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="12, 0, 0, 0"/>`

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`

const CRC = Array.from({ length: 256 }, (_, index) => {
  let value = index

  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1

  return value >>> 0
})

const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff

  for (const byte of bytes) value = CRC[(value ^ byte) & 0xff]! ^ (value >>> 8)

  return (value ^ 0xffffffff) >>> 0
}

/** A ZIP of the files in order, stored without compression; Hangul reads `mimetype` first and expects it stored. */
export function zip(files: readonly { readonly name: string; readonly data: Uint8Array }[]) {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = new Uint8Array(30 + name.length)
    const head = new DataView(local.buffer)

    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true)
    head.setUint16(8, 0, true)
    head.setUint16(10, 0, true)
    head.setUint16(12, 0x21, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, file.data.length, true)
    head.setUint32(22, file.data.length, true)
    head.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const entry = new DataView(central.buffer)

    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, 0, true)
    entry.setUint16(14, 0x21, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, file.data.length, true)
    entry.setUint32(24, file.data.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, file.data)
    centrals.push(central)
    offset += local.length + file.data.length
  }
  const directory = centrals.reduce((sum, item) => sum + item.length, 0)
  const end = new Uint8Array(22)
  const tail = new DataView(end.buffer)

  tail.setUint32(0, 0x06054b50, true)
  tail.setUint16(8, files.length, true)
  tail.setUint16(10, files.length, true)
  tail.setUint32(12, directory, true)
  tail.setUint32(16, offset, true)
  const out = new Uint8Array(offset + directory + end.length)
  let at = 0

  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }

  return out
}

/** The table as an HWPX file: the title lines (the draft's name, then 신·구조문대비표) and each article's rows. */
export function document(titles: readonly string[], articles: readonly (readonly LawAmendment.Row[])[]) {
  const encoder = new TextEncoder()

  return zip([
    { name: "mimetype", data: encoder.encode("application/hwp+zip") },
    { name: "version.xml", data: encoder.encode(VERSION) },
    { name: "META-INF/container.xml", data: encoder.encode(CONTAINER) },
    { name: "Contents/content.hpf", data: encoder.encode(content(titles[0] ?? "")) },
    { name: "Contents/header.xml", data: encoder.encode(header()) },
    { name: "Contents/section0.xml", data: encoder.encode(section(titles, articles)) },
    { name: "settings.xml", data: encoder.encode(SETTINGS) },
    { name: "Preview/PrvText.txt", data: encoder.encode(titles.join("\r\n")) },
  ])
}
