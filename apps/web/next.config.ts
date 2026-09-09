import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_BACKEND_ORIGIN ?? 'http://127.0.0.1:3200'}/api/:path*` }];
  },
};
export default nextConfig;
