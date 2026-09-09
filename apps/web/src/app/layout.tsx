import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistSans-Variable.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
  weight: '100 900',
  fallback: ['Apple SD Gothic Neo', 'Malgun Gothic', 'sans-serif'],
});

export const metadata: Metadata = { title: 'STM Order & Stock', description: 'B2B 주문·재고·출고·정산 시스템' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className={geistSans.variable}><body>{children}</body></html>;
}
