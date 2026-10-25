import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ngNativeWeb } from '@ng-native/web/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * The browser build: the same NG Native screens rendered through `@ng-native/web`, and the game
 * page they embed. On a phone the game page lives in a web view; here it lives in an iframe, and
 * these two plugins make that swap without touching the app's source:
 *
 * - `@ng-native/expo/dom-component` resolves to the iframe version of `<dom-component>`.
 * - A `'use dom'` file imported from the native screens resolves to a reference to its page
 *   (`game.html`), as Metro's transformer turns it into a reference on device. The page's own
 *   entry still imports the real file.
 */

const root = dirname(fileURLToPath(import.meta.url));
const DOM_PAGES: Record<string, string> = {
  [resolve(root, 'src/web/game-view.ts')]: 'game.html',
};
const REF = '\0dom-component-ref:';

function domComponentReferences(): Plugin {
  return {
    name: 'bwbt:dom-component-references',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.replaceAll('\\', '/').includes('/src/web/')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const page = resolved && DOM_PAGES[resolve(resolved.id.split('?')[0])];
      return page ? REF + page : null;
    },
    load(id) {
      return id.startsWith(REF) ? `export default { domComponent: ${JSON.stringify(id.slice(REF.length))} };` : null;
    },
  };
}

/**
 * The game page's stylesheet names its fonts as `../fonts/…` relative to itself, which Metro
 * resolves for the app. The browser build inlines component CSS without rewriting `url()`, so the
 * page asks for `/fonts/…`: serve that path in development and emit it in the build.
 */
function gameFonts(): Plugin {
  const fonts = ['BalooBhaijaan2_400Regular.ttf', 'BalooBhaijaan2_600SemiBold.ttf', 'BalooBhaijaan2_800ExtraBold.ttf'];
  return {
    name: 'bwbt:game-fonts',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const name = basename((req.url ?? '').split('?')[0]);
        if (!fonts.includes(name)) return next();
        res.setHeader('content-type', 'font/ttf');
        res.end(readFileSync(resolve(root, 'src/fonts', name)));
      });
    },
    generateBundle() {
      for (const font of fonts) {
        this.emitFile({ type: 'asset', fileName: `fonts/${basename(font)}`, source: readFileSync(resolve(root, 'src/fonts', font)) });
      }
    },
  };
}

/** Development only: art-export.html posts PNGs here, written to assets/art for the native screens. */
function artExport(): Plugin {
  return {
    name: 'bwbt:art-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__art', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const { name, png } = JSON.parse(body) as { name: string; png: string };
          if (!/^[a-z0-9-]+$/.test(name) || !png.startsWith('data:image/png;base64,')) {
            res.statusCode = 400;
            res.end();
            return;
          }
          const dir = resolve(root, 'assets/art');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.png`), Buffer.from(png.slice('data:image/png;base64,'.length), 'base64'));
          res.statusCode = 201;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [domComponentReferences(), gameFonts(), artExport(), ngNativeWeb()],
  resolve: {
    alias: {
      '@ng-native/expo/dom-component': resolve(root, 'src/web-host/dom-component.web.ts'),
    },
  },
  publicDir: false,
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: 'dist-web',
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      input: {
        main: resolve(root, 'index.html'),
        game: resolve(root, 'game.html'),
      },
    },
  },
});
