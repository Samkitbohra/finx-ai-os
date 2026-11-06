import { redirect } from 'next/navigation';
import { getBorrowerId } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export default async function In({ children }: { children: React.ReactNode }) {
  if (!(await getBorrowerId())) redirect('/app/login');
  return <>{children}</>;
}
