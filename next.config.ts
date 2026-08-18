import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/L0xGames/mediprac_landing/main/public/assets/**",
      },
    ],
  },
};

export default nextConfig;
