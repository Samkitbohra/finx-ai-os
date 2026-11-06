export const metadata = { title: 'FinX — your loan' };
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="bloom min-h-screen"><div className="mx-auto max-w-md px-4 pb-16 pt-6">{children}</div></div>;
}
