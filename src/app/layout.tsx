import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compass · Platform Lab",
  description: "Compass platform contracts and sign-in prototype.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Compass",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#090b0e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
