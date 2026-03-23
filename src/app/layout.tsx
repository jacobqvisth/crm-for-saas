import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM for SaaS",
  description: "Modern CRM with email sequencing for SaaS companies",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: "#fff",
              color: "#0f172a",
              border: "1px solid #e2e8f0",
            },
          }}
        />
      </body>
    </html>
  );
}
