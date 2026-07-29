import { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, type, onDismiss, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [onDismiss, durationMs]);

  const alertClass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-error' : 'alert-info';

  return (
    <div className={`alert ${alertClass} shadow-lg max-w-sm`}>
      <span className="text-sm">{message}</span>
    </div>
  );
}

/** Toast 容器 — 固定在右上角 */
export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="toast toast-top toast-end z-[100]">
      {children}
    </div>
  );
}
