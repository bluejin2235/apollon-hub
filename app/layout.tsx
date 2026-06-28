import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Noto_Sans_KR } from "next/font/google";
import { APP_TITLE } from "@/lib/portal/app-title";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap"
});

export const metadata: Metadata = {
  title: APP_TITLE,
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
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-3MKLHC3LS4"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-3MKLHC3LS4');
  `}
        </Script>
        <div className="mx-auto w-full max-w-7xl bg-white px-4 sm:px-6">{children}</div>
      </body>
    </html>
  );
}
