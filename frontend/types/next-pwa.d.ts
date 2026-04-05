declare module "next-pwa" {
  interface PWAConfig {
    dest?: string;
    disable?: boolean;
    register?: boolean;
    skipWaiting?: boolean;
    runtimeCaching?: any[];
  }

  function withPWA(pwaConfig: PWAConfig): (nextConfig: any) => any;
  export = withPWA;
}
