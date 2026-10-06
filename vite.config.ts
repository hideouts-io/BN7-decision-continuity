import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  server: { watch: { ignored: ["**/.local/**", "**/output/**"] } },
  build: { rolldownOptions: { input: { walkthrough: fileURLToPath(new URL("./index.html", import.meta.url)), decisions: fileURLToPath(new URL("./decisions.html", import.meta.url)), impact: fileURLToPath(new URL("./impact.html", import.meta.url)) } } },
});
