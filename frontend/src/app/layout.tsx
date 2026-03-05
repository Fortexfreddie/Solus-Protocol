import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/Toaster";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Solus Protocol | Mission Control",
  description:
    "Autonomous, auditable, on-chain AI agents that think, get audited, prove their reasoning on-chain, and trade — without human intervention. Built on Solana Devnet.",
  keywords: [
    "Solana",
    "DeFi",
    "AI Agents",
    "Autonomous Trading",
    "Blockchain",
    "Solus Protocol",
    "On-Chain AI",
    "Proof of Reasoning",
    "Air-Gap Engine",
  ],
  authors: [{ name: "Solus Protocol" }],
  openGraph: {
    title: "Solus Protocol | Mission Control",
    description:
      "Autonomous AI agents with 7-layer air-gap security. Real-time observability into Rex, Nova, and Sage as they trade on Solana Devnet.",
    type: "website",
    siteName: "Solus Protocol",
  },
  twitter: {
    card: "summary_large_image",
    title: "Solus Protocol | Mission Control",
    description:
      "Autonomous AI agents with 7-layer air-gap security. Real-time observability into Rex, Nova, and Sage.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
