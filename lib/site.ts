// Single source of truth for brand + SEO metadata, reused across
// layout, sitemap, robots, manifest and JSON-LD.
export const site = {
  name: "Dekhlo",
  tagline: "Dekh lo, phir socho",
  title: "Dekhlo — Virtual Try-On for Pakistani Fashion",
  description:
    "See how a style might look on you before you decide. Dekhlo is an AI virtual try-on for Pakistani fashion — shalwar kameez, abayas, bridal, formal and western wear from local brands.",
  keywords: [
    "virtual try-on",
    "Pakistani fashion",
    "shalwar kameez try on",
    "abaya try on",
    "bridal try on",
    "AI clothes try on",
    "Pakistan clothing",
    "online try on",
  ],
  locale: "en_PK",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  themeColor: "#c67139",
} as const;
