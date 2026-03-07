import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  fullWidth = false,
  disabled = false,
  className = '',
  ...props
}: ButtonProps) {
  const sizeClasses = {
    sm: 'min-h-[36px] px-4 py-2 text-sm',
    md: 'min-h-[44px] px-6 py-3 text-base',
    lg: 'min-h-[52px] px-8 py-4 text-lg'
  };

  const baseClasses = `
    relative overflow-hidden rounded-btn font-semibold transition-all
    focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
    disabled:opacity-50 disabled:cursor-not-allowed
    ${sizeClasses[size]}
    ${fullWidth ? 'w-full' : ''}
    ${className}
  `;

  if (variant === 'primary') {
    return (
      <button
        disabled={disabled}
        className={`${baseClasses} bg-gradient-primary border border-white/10 text-white shadow-glow hover:shadow-glow-intense hover:brightness-110 hover:-translate-y-px`}
        {...props}
      >
        {children}
      </button>
    );
  }

  if (variant === 'secondary') {
    return (
      <button
        disabled={disabled}
        className={`${baseClasses} glass text-white hover:bg-white/[0.07] hover:border-white/[0.14]`}
        {...props}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      disabled={disabled}
      className={`${baseClasses} text-gray-300 hover:text-white hover:bg-white/5`}
      {...props}
    >
      {children}
    </button>
  );
}
