import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react({
      // CI sets NODE_ENV=test globally; force production JSX so bundles never
      // embed machine-specific jsxDEV fileName metadata.
      jsxRuntime: "automatic",
    }),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  esbuild: {
    jsxDev: false,
  },
  build: {
    outDir: resolve(__dirname, "../../apps/web/public/widget"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        loader: resolve(__dirname, "src/loader/index.ts"),
        app: resolve(__dirname, "src/app/main.tsx"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "loader") {
            return "loader.js";
          }
          if (chunk.name === "app") {
            return "app.js";
          }
          return "assets/[name]-[hash].js";
        },
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
