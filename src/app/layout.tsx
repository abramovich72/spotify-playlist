import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playlist Studio | ייבוא פלייליסט ל-Spotify",
  description: "טוענים רשימת שירים מקובץ ומייבאים אותה לפלייליסט Spotify.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
