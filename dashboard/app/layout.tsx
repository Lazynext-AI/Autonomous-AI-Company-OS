import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lazynext",
  description: "Lazynext - The Autonomous AI Company OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lazynext",
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: "/icon-192.png",
  },
};

export const viewport = {
  themeColor: "#8b5cf6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('lz_theme')||'dark';document.documentElement.dataset.density=localStorage.getItem('lz_density')||'comfortable'}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased bg-bg">{children}</body>
    </html>
  );
}
