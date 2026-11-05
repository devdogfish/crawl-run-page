import type { Metadata } from "next";
import { Provider } from "@/components/ui/provider";
import { AppNavbar } from "@/components/app-navbar";

export const metadata: Metadata = {
  title: "Crawls",
  description: "Crawl run page prototype (Chakra UI)",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Provider>
          <AppNavbar />
          {children}
        </Provider>
      </body>
    </html>
  );
}
