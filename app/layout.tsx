import type { Metadata } from 'next';
import AtlasAnalytics from '@/components/atlas-analytics';
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import './observatory.css';

const plexSans = IBM_Plex_Sans({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

const barlowCondensed = Barlow_Condensed({
  variable: '--font-observatory-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'https://umbra-eclipse.plhery.com',
  ),
  alternates: { canonical: '/' },
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
    images: [{ url: '/og-v2.png', width: 1731, height: 909, alt: 'Umbra solar eclipse atlas' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Umbra — Solar eclipse atlas',
    description: 'Follow the Moon’s shadow and see what happens at your location.',
    images: ['/og-v2.png'],
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
        className={`${plexSans.variable} ${plexMono.variable} ${barlowCondensed.variable} antialiased`}
      >
        {children}
        <AtlasAnalytics />
      </body>
    </html>
  );
}
