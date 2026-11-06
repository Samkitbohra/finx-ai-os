import { LoginForm } from './form';
export const metadata = { title: 'Sign in' };
export default function LoginPage() {
  return (
    <main className="bloom grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-display text-3xl font-semibold tracking-tight">FinX <span className="grad">AI</span></div>
          <p className="mt-2 text-sm text-dim">The operating system for lending enterprises</p>
        </div>
        <div className="card p-6"><LoginForm /></div>
        <p className="mt-6 text-center text-xs text-mute">Demo: owner@finx.demo · finx1234 — or manager, officer, accounts, collections, auditor @finx.demo</p>
      </div>
    </main>
  );
}
