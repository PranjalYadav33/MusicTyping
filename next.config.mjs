/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["ytmusic-api", "play-dl"],
};

export default nextConfig;
