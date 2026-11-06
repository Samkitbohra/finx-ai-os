'use client';
import { useActionState } from 'react';
import { login } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="space-y-4">
      <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="username" required className="input" defaultValue="owner@finx.demo" /></div>
      <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required className="input" defaultValue="finx1234" /></div>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
