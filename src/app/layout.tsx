import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProviderWithLogin } from "@/lib/auth-context";
import { Toaster } from "sonner";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AKN Returnable Asset Tracking",
  description: "Returnable asset tracking and circular supply chain management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${jetbrains.variable} bg-slate-50 text-slate-900 antialiased`}>
        <AuthProviderWithLogin>
          {children}
          <Toaster position="top-right" richColors />
        </AuthProviderWithLogin>
      </body>
    </html>
  );
}
