// An imported image: an asset id under Metro, a URL under Vite. `ui/art.ts` handles both.
declare module '*.png' {
  const asset: number | string;
  export default asset;
}
