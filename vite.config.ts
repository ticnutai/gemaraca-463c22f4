import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";
import { spawn, type ChildProcess } from "child_process";
import type { Plugin } from "vite";

/**
 * Vite plugin that manages the OCR Python server lifecycle.
 * Exposes POST /api/ocr-launcher/start to spawn the server process.
 */
function ocrServerLauncher(): Plugin {
  let ocrProcess: ChildProcess | null = null;
  const SCRIPT = path.resolve(
    process.env.USERPROFILE || process.env.HOME || ".",
    ".vscode/extensions/terminal-monitor/ocr-server/server.py"
  );

  return {
    name: "ocr-server-launcher",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/api/ocr-launcher/start" && req.method === "POST") {
          // Check if process is already alive
          if (ocrProcess && !ocrProcess.killed) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "already_running", pid: ocrProcess.pid }));
            return;
          }

          try {
            const child = spawn("python", [SCRIPT, "--port", "8399"], {
              stdio: ["ignore", "pipe", "pipe"],
              detached: false,
              windowsHide: true,
            });

            ocrProcess = child;

            child.stdout?.on("data", (d: Buffer) => {
              const msg = d.toString().trim();
              if (msg) console.log(`[OCR] ${msg}`);
            });
            child.stderr?.on("data", (d: Buffer) => {
              const msg = d.toString().trim();
              if (msg) console.log(`[OCR] ${msg}`);
            });
            child.on("exit", (code) => {
              console.log(`[OCR] Server exited (code=${code})`);
              ocrProcess = null;
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "started", pid: child.pid }));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "error", message }));
          }
          return;
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api/ocr": {
        target: "http://127.0.0.1:8399",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ocr/, ""),
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && ocrServerLauncher(),
    mode === "development" && componentTagger(),
    mode === "analyze" && visualizer({
      open: true,
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['robots.txt'],
      manifest: {
        name: 'תורה ומציאות - מערכת לימוד תורה מתקדמת',
        short_name: 'תורה ומציאות',
        description: 'מערכת ללימוד גמרא המחברת בין סוגיות לפסקי דין ומקרים מודרניים',
        theme_color: '#1e40af',
        background_color: '#ffffff',
        display: 'standalone',
        dir: 'rtl',
        lang: 'he',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // index.html is NOT precached: a precached copy fetched in the minutes
        // right after a publish can be the previous build's HTML, and returning
        // visitors then stay on the old version until the next publish.
        // Pages are fetched network-first instead; the cache is only the
        // offline fallback.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 20 },
            },
          },
          {
            // Backup history must always be live (listed right after a backup runs)
            urlPattern: /^https:\/\/jaotdqumpcfhcbkgtfib\.supabase\.co\/rest\/v1\/(data_backups|data_restores|user_roles)\b.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Cache Supabase API responses — show cached, refresh in background
            urlPattern: /^https:\/\/jaotdqumpcfhcbkgtfib\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 2 }, // 2 hours
            },
          },
          {
            // Cache Supabase Edge Functions responses
            urlPattern: /^https:\/\/jaotdqumpcfhcbkgtfib\.supabase\.co\/functions\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-functions-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 30 }, // 30 min
              networkTimeoutSeconds: 10,
            },
          },
          {
            // Cache Sefaria API
            urlPattern: /^https:\/\/www\.sefaria\.org\/api\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sefaria-api-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 1 week
            },
          },
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, // 1 year
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query': ['@tanstack/react-query'],
          'ui-core': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-accordion',
            '@radix-ui/react-popover',
            '@radix-ui/react-scroll-area',
          ],
          'icons': ['lucide-react'],
          'supabase': ['@supabase/supabase-js'],
          'recharts': ['recharts'],
        },
      },
    },
  },
}));
