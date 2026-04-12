/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://backend:3001/api/:path*',
      },
      {
        source: '/ws',
        destination: 'http://backend:3001/ws/',
      },
      {
        source: '/ws/:path*',
        destination: 'http://backend:3001/ws/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
