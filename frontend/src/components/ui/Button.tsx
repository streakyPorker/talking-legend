interface ButtonProps {
  variant: 'primary' | 'ghost' | 'circle';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  type?: 'button' | 'submit';
}

const variantClass: Record<ButtonProps['variant'], string> = {
  primary: 'btn btn-primary',
  ghost: 'btn btn-ghost',
  circle: 'btn btn-ghost btn-circle',
};

export function Button({
  variant,
  disabled,
  loading,
  onClick,
  children,
  ariaLabel,
  className = '',
  type = 'button',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      className={`${variantClass[variant]} ${className} ${loading ? 'loading' : ''}`}
    >
      {loading ? '…' : children}
    </button>
  );
}
