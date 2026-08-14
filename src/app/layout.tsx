import type { Metadata, Viewport } from 'next';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/constants';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_TAGLINE,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1F3864',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink">{children}</body>
    </html>
  );
}
