/// <reference types="vite/client" />

declare module 'pdfjs-dist/legacy/build/pdf' {
  export * from 'pdfjs-dist'
}
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.js?url' {
  const src: string
  export default src
}

interface ImportMetaEnv {
  readonly VITE_ARK_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
