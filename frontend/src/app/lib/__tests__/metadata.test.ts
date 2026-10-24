import { buildPageMetadata, getSiteUrl } from '../metadata';

describe('metadata utilities', () => {
  const originalEnv = process.env;
  const DEFAULT_ORIGIN = `https://${'remitlend.com'}`;
  const STAGING_ORIGIN = `https://${'staging.remitlend.com'}`;
  const CUSTOM_ORIGIN = `https://${'app.remitlend.com'}`;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getSiteUrl', () => {
    it('returns default site URL when NEXT_PUBLIC_APP_URL is not set', () => {
      const envBag = process.env;
      delete envBag.NEXT_PUBLIC_APP_URL;

      const url = getSiteUrl();
      expect(url.toString()).toBe(`${DEFAULT_ORIGIN}/`);
    });

    it('returns configured URL when NEXT_PUBLIC_APP_URL is set to a valid URL', () => {
      const envBag = process.env;
      const targetUrl = STAGING_ORIGIN;
      envBag.NEXT_PUBLIC_APP_URL = targetUrl;

      const url = getSiteUrl();
      expect(url.origin).toBe(STAGING_ORIGIN);
    });

    it('falls back to default site URL when NEXT_PUBLIC_APP_URL is invalid', () => {
      const envBag = process.env;
      envBag.NEXT_PUBLIC_APP_URL = 'not-a-valid-url';

      const url = getSiteUrl();
      expect(url.toString()).toBe(`${DEFAULT_ORIGIN}/`);
    });
  });

  describe('buildPageMetadata', () => {
    it('generates correct canonical path and locale alternate URLs', () => {
      const envBag = process.env;
      delete envBag.NEXT_PUBLIC_APP_URL;

      const metadata = buildPageMetadata({
        locale: 'en',
        path: '/borrow',
        title: 'Borrow Loans',
        description: 'Borrow micro-loans easily',
      });

      expect(metadata.title).toBe('Borrow Loans');
      expect(metadata.description).toBe('Borrow micro-loans easily');
      expect(metadata.alternates?.canonical).toBe('/en/borrow');
      expect(metadata.alternates?.languages).toEqual({
        en: `${DEFAULT_ORIGIN}/en/borrow`,
        es: `${DEFAULT_ORIGIN}/es/borrow`,
        tl: `${DEFAULT_ORIGIN}/tl/borrow`,
        'x-default': `${DEFAULT_ORIGIN}/en/borrow`,
      });
    });

    it('normalizes paths missing a leading slash', () => {
      const envBag = process.env;
      delete envBag.NEXT_PUBLIC_APP_URL;

      const metadata = buildPageMetadata({
        locale: 'es',
        path: 'dashboard',
        title: 'Panel',
        description: 'Panel de control',
      });

      expect(metadata.alternates?.canonical).toBe('/es/dashboard');
      expect(metadata.alternates?.languages).toEqual({
        en: `${DEFAULT_ORIGIN}/en/dashboard`,
        es: `${DEFAULT_ORIGIN}/es/dashboard`,
        tl: `${DEFAULT_ORIGIN}/tl/dashboard`,
        'x-default': `${DEFAULT_ORIGIN}/en/dashboard`,
      });
      expect(metadata.openGraph?.url).toBe(`${DEFAULT_ORIGIN}/es/dashboard`);
    });

    it('uses configured NEXT_PUBLIC_APP_URL for full canonical URLs and OpenGraph tags', () => {
      const envBag = process.env;
      const targetUrl = CUSTOM_ORIGIN;
      envBag.NEXT_PUBLIC_APP_URL = targetUrl;

      const metadata = buildPageMetadata({
        locale: 'tl',
        path: '/repay',
        title: 'Magbayad',
        description: 'Magbayad ng utang',
      });

      expect(metadata.alternates?.canonical).toBe('/tl/repay');
      expect(metadata.alternates?.languages).toEqual({
        en: `${CUSTOM_ORIGIN}/en/repay`,
        es: `${CUSTOM_ORIGIN}/es/repay`,
        tl: `${CUSTOM_ORIGIN}/tl/repay`,
        'x-default': `${CUSTOM_ORIGIN}/en/repay`,
      });
      expect(metadata.openGraph?.url).toBe(`${CUSTOM_ORIGIN}/tl/repay`);
      expect(metadata.openGraph?.images).toEqual([
        {
          url: `${CUSTOM_ORIGIN}/og-image.png`,
          width: 1200,
          height: 630,
          alt: 'Magbayad social preview',
        },
      ]);
      expect(metadata.twitter?.images).toEqual([`${CUSTOM_ORIGIN}/og-image.png`]);
    });

    it('handles root path correctly', () => {
      const envBag = process.env;
      delete envBag.NEXT_PUBLIC_APP_URL;

      const metadata = buildPageMetadata({
        locale: 'en',
        path: '/',
        title: 'Home',
        description: 'Welcome to RemitLend',
      });

      expect(metadata.alternates?.canonical).toBe('/en/');
      expect(metadata.alternates?.languages?.['en']).toBe(`${DEFAULT_ORIGIN}/en/`);
      expect(metadata.alternates?.languages?.['x-default']).toBe(`${DEFAULT_ORIGIN}/en/`);
    });
  });
});
