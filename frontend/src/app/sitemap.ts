import type { MetadataRoute } from "next";
import { getSiteUrl } from "./lib/metadata";

const BASE_URL = getSiteUrl().toString();

const locales = ["en", "es", "tl"] as const;

function getAlternates(path: string) {
  return {
    languages: Object.fromEntries(
      locales.map((locale) => [locale, `${BASE_URL}/${locale}${path}`]),
    ),
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${BASE_URL}/en`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
      alternates: getAlternates(""),
    },
    {
      url: `${BASE_URL}/en/lend`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
      alternates: getAlternates("/lend"),
    },
    {
      url: `${BASE_URL}/en/liquidations`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.7,
      alternates: getAlternates("/liquidations"),
    },
    {
      url: `${BASE_URL}/en/kingdom`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
      alternates: getAlternates("/kingdom"),
    },
  ];
}
