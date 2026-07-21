import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Output Judge",
  description:
    "Compare two AI-generated outputs for the same task and see which is better, with reasoning.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
