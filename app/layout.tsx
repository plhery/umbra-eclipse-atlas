import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'https://umbra-eclipse-atlas.sites.openai.com',
  ),
  title: {
    default: 'Umbra — Solar eclipse atlas',
    template: '%s · Umbra',
  },
  description:
    'Explore five millennia of solar eclipses, follow the Moon’s shadow, and calculate what you will see from any place on Earth.',
  openGraph: {
    title: 'Umbra — Solar eclipse atlas',
    description:
      'Every solar eclipse, mapped with local times, visibility, terrain, and field-ready exports.',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'Umbra solar eclipse atlas' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Umbra — Solar eclipse atlas',
    description: 'Follow the Moon’s shadow and see what happens at your location.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
