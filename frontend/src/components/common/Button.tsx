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
    relative overflow-hidden rounded-xl font-semibold transition-all
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
        className={`${baseClasses} group`}
        {...props}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500 via-primary-400 to-accent-500 rounded-xl blur opacity-50 group-hover:opacity-75 transition-opacity" />
        <div className={`relative bg-gradient-to-br from-primary-500 via-primary-400 to-accent-500 rounded-xl text-white flex items-center justify-center ${sizeClasses[size]}`}>
          {children}
        </div>
      </button>
    );
  }
  
  if (variant === 'secondary') {
    return (
      <button
        disabled={disabled}
        className={`${baseClasses} glass text-white hover:bg-white/10`}
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
