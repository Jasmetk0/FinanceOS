import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinanceOS",
    short_name: "FinanceOS",
    description: "Local-first personal finance and investment dashboard.",
    start_url: "/",
    display: "standalone",
    background_color: "#07100d",
    theme_color: "#07100d",
    orientation: "any",
    icons: [
      {
        src: "/financeos-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
