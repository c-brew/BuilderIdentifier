import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (pdfjs under the hood) breaks when webpack bundles it into the
  // RSC server build — load it from node_modules at runtime instead.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
