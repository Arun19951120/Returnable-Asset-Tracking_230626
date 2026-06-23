import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProviderWithLogin } from "@/lib/auth-context";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AKN Returnable Asset Tracking",
  description: "Returnable asset tracking and circular supply chain management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50 text-slate-900 antialiased`}>
        <AuthProviderWithLogin>
          {children}
          <Toaster position="top-right" richColors />
        </AuthProviderWithLogin>
      </body>
    </html>
  );
}
