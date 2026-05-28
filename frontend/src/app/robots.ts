import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/api/",
          "/[locale]/activity",
          "/[locale]/admin",
          "/[locale]/analytics",
          "/[locale]/loans",
          "/[locale]/notifications",
          "/[locale]/remittances",
          "/[locale]/repay",
          "/[locale]/request-loan",
          "/[locale]/send-remittance",
          "/[locale]/settings",
          "/[locale]/wallet",
        ],
      },
    ],
    sitemap: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://remitlend.com"}/sitemap.xml`,
  };
}
