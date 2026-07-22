/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Try-on returns a large base64 image from the route handler.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  // Dekhlo does not use next/image; disable the built-in optimizer temporarily
  // while Next.js ships with a patched optional sharp dependency.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
