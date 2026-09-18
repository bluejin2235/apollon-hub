import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "루나 문답",
  description: "루나에게 짧게 답하기",
  manifest: "/luna-qa.webmanifest",
  appleWebApp: {
    capable: true,
    title: "루나 문답",
    statusBarStyle: "default"
  },
  icons: {
    apple: "/luna/luna-face.png"
  }
};

export const viewport: Viewport = {
  themeColor: "#534AB7",
  width: "device-width",
  initialScale: 1
};

export default function QLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-white">{children}</div>
  );
}
