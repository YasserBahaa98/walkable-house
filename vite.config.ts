import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // three.js changes rarely: keep it in its own long-cached chunk.
        advancedChunks: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ }] },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Walkable House',
        short_name: 'WalkHouse',
        description: 'Turn your house plans into a walkable, editable 3D home.',
        theme_color: '#e8467c',
        background_color: '#f6f1ee',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is precached; the 11 MB CAD reader is cached on first use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // The CAD reader and the Anthropic SDK (photo/link import) load on first use.
        globIgnores: ['**/cad.worker-*.js', '**/sdk-*.js'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: ({ url }) => /\.wasm$|cad\.worker-.*\.js$|\/sdk-[\w-]+\.js$/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'cad-reader', expiration: { maxEntries: 6 } },
        }, {
          // Material textures load on demand and are kept for offline use.
          urlPattern: ({ url }) => /\/textures\/.*\.webp$/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'textures', expiration: { maxEntries: 120 } },
        }],
      },
    }),
  ],
});
