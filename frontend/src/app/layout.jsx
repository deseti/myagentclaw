import './globals.css';
import Providers from '@/components/providers';

export const metadata = {
  title: 'myagentclaw',
  description: 'AI Agent Dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
