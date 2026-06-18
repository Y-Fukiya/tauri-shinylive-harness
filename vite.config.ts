import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/portal",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  }
});
