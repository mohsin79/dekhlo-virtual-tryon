/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Try-on returns a large base64 image from the route handler.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
