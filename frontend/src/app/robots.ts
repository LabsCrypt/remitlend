import type { MetadataRoute } from "next";
import { getSiteUrl } from "./lib/metadata";

const BASE_URL = getSiteUrl().toString();

const locales = ["en", "es", "tl"] as const;

const privateRoutes = [
  "/activity",
  "/admin",
  "/analytics",
  "/loans",
  "/notifications",
  "/remittances",
  "/repay",
  "/request-loan",
  "/send-remittance",
  "/settings",
  "/wallet",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/api/",
          ...locales.flatMap((locale) => privateRoutes.map((route) => `/${locale}${route}`)),
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
