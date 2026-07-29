interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  label?: string;
  type?: 'text' | 'number';
}

export function Input({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  className = '',
  id,
  label,
  type = 'text',
}: InputProps) {
  const input = (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className={`input input-bordered w-full ${className}`}
    />
  );

  if (label) {
    return (
      <label className="form-control w-full">
        <div className="label"><span className="label-text">{label}</span></div>
        {input}
      </label>
    );
  }
  return input;
}
