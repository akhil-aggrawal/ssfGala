import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SSF Gala — An Evening That Moves You",
  description: "Small Steps Foundation Gala, January 23, 2027, ICC Milpitas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
