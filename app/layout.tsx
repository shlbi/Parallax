import type { Metadata } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import './analysis.css';
export const metadata: Metadata = {
 title: 'PARALLAX — Investigation workspace',
 description: 'Explore the PARALLAX interface. Interactive design preview using fictional evidence and a controlled camera experiment.',
 icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en" className="dark"><body>{children}</body></html>; }
