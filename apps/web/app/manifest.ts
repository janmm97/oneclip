import type { MetadataRoute } from "next";

/** Lets Chrome/Edge install OneClip as its own app window (menu → Cast, save and share → Install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OneClip",
    short_name: "OneClip",
    description: "Local AI video clipper: finds the strongest hooks in your video and renders vertical clips on your machine.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#07070b",
    theme_color: "#07070b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
