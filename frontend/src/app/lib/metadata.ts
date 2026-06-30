import type { Metadata } from "next";

type PageMetadataInput = {
  locale: string;
  path: string;
  title: string;
  description: string;
};

const LOCALES = ["en", "es", "tl"] as const;
const DEFAULT_SITE_URL = "https://remitlend.com";
const SITE_NAME = "RemitLend";
const OG_IMAGE_PATH = "/og-image.png";

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_SITE_URL;

  try {
    return new URL(configuredUrl);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

export function buildPageMetadata({
  locale,
  path,
  title,
  description,
}: PageMetadataInput): Metadata {
  const siteUrl = getSiteUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const pathname = `/${locale}${normalizedPath}`;
  const url = new URL(pathname, siteUrl).toString();
  const ogImage = new URL(OG_IMAGE_PATH, siteUrl).toString();

  const languages = Object.fromEntries(
    LOCALES.map((loc) => [loc, new URL(`/${loc}${normalizedPath}`, siteUrl).toString()]),
  );
  languages["x-default"] = new URL(`/en${normalizedPath}`, siteUrl).toString();

  return {
    title,
    description,
    alternates: {
      canonical: pathname,
      languages,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${title} social preview`,
        },
      ],
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}
