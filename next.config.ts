import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Enables forbidden() for the 403 page on role checks.
  experimental: { authInterrupts: true },
};

export default nextConfig;
