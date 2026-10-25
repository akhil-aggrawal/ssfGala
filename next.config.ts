import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Enables forbidden() for the 403 page on role checks.
  experimental: { authInterrupts: true },
  // The old Stripe success URL: sessions opened before the move to
  // /tickets/success still return here. The query (session_id) carries over.
  async redirects() {
    return [{ source: "/tickets/checkout/success", destination: "/tickets/success", permanent: false }];
  },
};

export default nextConfig;
