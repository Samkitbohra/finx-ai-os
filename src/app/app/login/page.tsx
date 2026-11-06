import { OtpForm } from './form';
export default function Login() {
  return (
    <main className="pt-16">
      <div className="mb-8 text-center"><div className="font-display text-3xl font-semibold">FinX</div><p className="mt-2 text-sm text-dim">Your loan, your balance, your receipts.<br />உங்கள் கடன் · आपका लोन</p></div>
      <div className="card p-6"><OtpForm /></div>
    </main>
  );
}
