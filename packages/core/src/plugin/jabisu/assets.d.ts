// Bundled skill files: text files embed as strings, binary files as the paths of embedded files.
declare module "*.sh" {
  const content: string
  export default content
}

declare module "*.py" {
  const content: string
  export default content
}

declare module "*.ps1" {
  const content: string
  export default content
}

declare module "*.hpf" {
  const content: string
  export default content
}

declare module "*.rdf" {
  const content: string
  export default content
}

declare module "*/mimetype" {
  const content: string
  export default content
}

declare module "*.hwpx" {
  const file: string
  export default file
}

declare module "*.png" {
  const file: string
  export default file
}
