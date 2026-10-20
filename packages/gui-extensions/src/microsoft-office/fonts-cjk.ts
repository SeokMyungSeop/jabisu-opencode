// `@betteroffice/fonts` imports its optional Chinese, Japanese and Korean add-on on demand. The add-on is about 33 MB,
// so the app aliases it to this module, which offers only the add-on's Korean face (4.5 MB, SIL OFL 1.1 — see
// fonts/OFL-NotoCJK.txt): Chinese and Japanese fall back to the bundled Latin faces.
export const CJK_FONT_ASSET_URLS = {
  "NotoSansKR-Regular.otf": () => new URL("./fonts/NotoSansKR-Regular.otf", import.meta.url),
}
