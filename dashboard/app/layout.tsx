import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lazynext",
  description: "Lazynext: The Autonomous AI Company OS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
