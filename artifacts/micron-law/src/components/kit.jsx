import { Link } from 'wouter';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ThemeToggle } from '@/components/theme';
import { cn } from '@/lib/utils';
export function Brand({ small = false }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-[13px] font-semibold">
        م
      </span>
      {!small && <span className="text-[15px] font-semibold tracking-tight">مايكرون</span>}
    </span>
  );
}
export function PrimaryButton({ loading, children, className, variant = 'primary', ...p }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cn(
        'inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:cursor-not-allowed',
        variant === 'outline'
          ? 'border border-input bg-background text-foreground hover:bg-accent active:bg-muted'
          : 'bg-primary text-primary-foreground hover:opacity-90 active:opacity-80',
        loading && 'disabled:opacity-100',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
export function Field({ label, hint, error, id, ...p }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-foreground/80">
        {label}
      </label>
      <input
        id={id}
        {...p}
        className={`h-12 w-full rounded-lg border bg-card px-3.5 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/40 read-only:bg-muted read-only:text-muted-foreground ${error ? 'border-destructive' : 'border-input'}`}
      />
      {error ? (
        <p className="text-[12.5px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
export function ErrorNote({ children, testId = 'text-error' }) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13.5px] text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
export function AuthFrame({ children, footer }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link href="/" data-testid="link-home" className="rounded-md">
          <Brand />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-5 pb-10 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
      {footer && (
        <footer className="px-5 pb-8 text-center text-[13px] text-muted-foreground">
          {footer}
        </footer>
      )}
    </div>
  );
}
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}
