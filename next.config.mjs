import { withSentryConfig } from "@sentry/nextjs";

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

const hasSentryUploadCredentials = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !hasSentryUploadCredentials,
  sourcemaps: {
    disable: !hasSentryUploadCredentials,
  },
  webpack: {
    autoInstrumentAppDirectory: false,
    autoInstrumentServerFunctions: true,
    autoInstrumentMiddleware: false,
    treeshake: {
      removeTracing: true,
      excludeReplayIframe: true,
      excludeReplayShadowDOM: true,
      excludeReplayCompressionWorker: true,
    },
  },
});
