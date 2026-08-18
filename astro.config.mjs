import { defineConfig } from "astro/config";

const site = process.env.SITE_URL || "https://maobaolong.github.io";
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  site,
  base,
  output: "static",
  markdown: {
    shikiConfig: {
      theme: "github-dark",
      wrap: true
    }
  }
});
