import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Compass",
    short_name: "Compass",
    description: "A personal compass for your day.",
    start_url: "/",
    display: "standalone",
    background_color: "#090b0e",
    theme_color: "#090b0e",
    icons: [
      { src: "/compass.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/compass.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
