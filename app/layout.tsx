import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#06141b",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Surfscape - Read the Ocean",
  description:
    "A living, browser-based surf experience powered by real marine conditions from the world's most iconic breaks.",
  applicationName: "Surfscape",
  manifest: "./manifest.webmanifest",
  icons: {
    icon: [{ url: "./icons/surfscape-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "./icons/surfscape-180.png", type: "image/png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Surfscape",
  },
  formatDetection: {
    telephone: false,
  },
  keywords: ["surfing", "browser game", "ocean", "waves", "OpenStreetMap"],
  openGraph: {
    title: "Surfscape - Read the Ocean",
    description: "Choose a real break. Read a living ocean. Chase the clean line.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Surfscape - Read the Ocean",
    description: "A living surf experience in your browser.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta property="og:image" content="./og.jpg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Surfscape surfer carving a glassy wave at golden hour" />
        <meta name="twitter:image" content="./og.jpg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
