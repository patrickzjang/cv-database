import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import { Outfit } from "next/font/google";
import { cn } from "@/lib/utils";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans", weight: ["400","500","600","700","800"] });

export const metadata: Metadata = {
  title: "Cloud Vision Product Management",
  description: "Product images & master data",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans antialiased", outfit.variable)}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <NavBar />
        <div className="main-content">
          {children}
        </div>
      </body>
    </html>
  );
}
