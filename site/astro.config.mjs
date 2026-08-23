import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// موقع النشر على GitHub Pages (مشروع، لذا base = /whatsapp-sticker-bot)
export default defineConfig({
  site: "https://rn0x.github.io/whatsapp-sticker-bot/",
  base: "/whatsapp-sticker-bot",
  trailingSlash: "ignore",
  integrations: [sitemap()],
  i18n: {
    defaultLocale: "ar",
    locales: ["ar", "en"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
