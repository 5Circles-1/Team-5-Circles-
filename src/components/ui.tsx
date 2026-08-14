/**
 * Small shadcn-style primitives on the 5C tokens: 8px grid, 6px radius,
 * 1px hairlines instead of shadows, colour only in status marks.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as React from 'react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded font-medium transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-navy-900 text-white hover:bg-navy-800',
        secondary: 'bg-surface text-ink hairline hover:bg-paper',
        ghost: 'text-ink-muted hover:text-ink hover:bg-paper',
        danger: 'bg-surface text-attention hairline hover:bg-paper',
      },
      size: {
        sm: 'h-8 px-3 text-scale-5',
        md: 'h-10 px-4 text-scale-4',
        lg: 'h-12 px-5 text-scale-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('bg-surface hairline rounded-lg', className)} {...props} />
);

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-4 py-3 hairline-b flex items-center justify-between gap-2', className)} {...props} />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn('font-display text-scale-3 font-semibold text-ink', className)} {...props} />
);

export const CardBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-4', className)} {...props} />
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded hairline bg-surface px-3 text-scale-4 text-ink placeholder:text-ink-muted',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded hairline bg-surface px-3 py-2 text-scale-4 text-ink placeholder:text-ink-muted min-h-[80px]',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn('h-10 w-full rounded hairline bg-surface px-3 text-scale-4 text-ink', className)}
    {...props}
  />
));
Select.displayName = 'Select';

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  // The workbook's blue "you type here" carries over: inputs are labelled in --input
  <label className={cn('block text-scale-5 font-medium text-[--input] mb-1', className)} {...props} />
);

export const Field = ({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: string;
}) => (
  <div>
    <Label>{label}</Label>
    {children}
    {hint ? <p className="mt-1 text-scale-6 text-ink-muted">{hint}</p> : null}
  </div>
);

/** Amber inline guard note (§6.4 — never a blocking dialog). */
export const GuardNote = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded border border-behind/40 bg-behind/5 px-3 py-2 text-scale-5 text-behind flex gap-2 items-start">
    <span aria-hidden>▲</span>
    <div>{children}</div>
  </div>
);

/** The one cream control cell per screen (week selector etc.). */
export const ControlCell = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('inline-flex items-center gap-2 rounded bg-cream-100 hairline px-3 py-2', className)} {...props} />
);

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="py-10 text-center">
    <p className="text-scale-4 text-ink">{title}</p>
    {hint ? <p className="mt-1 text-scale-5 text-ink-muted">{hint}</p> : null}
  </div>
);
