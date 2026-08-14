import { PRODUCT_NAME } from '@/lib/constants';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in' };

/** §13.A — magic link + Google. Nothing else on the page. */
export default function SignInPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-paper">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-navy-900 flex items-center justify-center">
            <FiveCirclesMark />
          </div>
          <h1 className="font-display text-scale-1 font-bold text-ink">{PRODUCT_NAME}</h1>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}

function FiveCirclesMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      {[10, 8, 6, 4, 2].map((r) => (
        <circle key={r} cx="14" cy="14" r={r + 2} fill="none" stroke="white" strokeOpacity={r === 10 ? 0.95 : 0.35 + r * 0.05} strokeWidth="1.4" />
      ))}
    </svg>
  );
}
