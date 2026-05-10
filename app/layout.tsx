import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap"
});

export const metadata: Metadata = {
  title: "Apollon OS",
  description: "아폴론 팀 내부 서비스를 위한 통합 포털"
};

export const viewport: Viewport = {
  colorScheme: "light"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="light" suppressHydrationWarning>
      <body className={`${notoSansKr.className} bg-white text-gray-900`}>
        <div className="mx-auto w-full max-w-7xl bg-white px-6">{children}</div>
      </body>
    </html>
  );
}
