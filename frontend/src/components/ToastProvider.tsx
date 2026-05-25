import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastTone = "info" | "success" | "warning" | "danger";

type ToastInput = {
  tone?: ToastTone;
  variant?: "default" | "order-sales";
  icon?: ReactNode;
  title: string;
  message?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onClick?: () => void;
  duration?: number;
  persistent?: boolean;
};

type ConfirmToastInput = {
  tone?: Extract<ToastTone, "warning" | "danger">;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
};

type ToastItem = ToastInput & {
  id: number;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => number;
  confirmToast: (toast: ConfirmToastInput) => number;
  dismissToast: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toneIcon: Record<ToastTone, string> = {
  info: "i",
  success: "OK",
  warning: "!",
  danger: "!",
};

function ToastCard({ toast, dismissToast }: { toast: ToastItem; dismissToast: (id: number) => void }) {
  useEffect(() => {
    if (toast.persistent) return;
    const timeout = window.setTimeout(() => dismissToast(toast.id), toast.duration ?? 5200);
    return () => window.clearTimeout(timeout);
  }, [dismissToast, toast.duration, toast.id, toast.persistent]);

  const isClickable = Boolean(toast.onClick);

  return (
    <article
      className={`app-toast app-toast-${toast.tone} app-toast-${toast.variant ?? "default"}${isClickable ? " app-toast-clickable" : ""}`}
      role={toast.tone === "danger" ? "alert" : "status"}
      tabIndex={isClickable ? 0 : undefined}
      onClick={() => {
        toast.onClick?.();
        if (isClickable) dismissToast(toast.id);
      }}
      onKeyDown={(event) => {
        if (!isClickable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toast.onClick?.();
          dismissToast(toast.id);
        }
      }}
    >
      <div className="app-toast-icon" aria-hidden="true">
        {toast.icon ?? toneIcon[toast.tone]}
      </div>
      <div className="app-toast-body">
        <p className="app-toast-title">{toast.title}</p>
        {toast.message ? <div className="app-toast-message">{toast.message}</div> : null}
        {toast.actionLabel || toast.secondaryActionLabel ? (
          <div className="app-toast-actions">
            {toast.secondaryActionLabel ? (
              <button
                type="button"
                className="app-toast-action app-toast-action-secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  toast.onSecondaryAction?.();
                  dismissToast(toast.id);
                }}
              >
                {toast.secondaryActionLabel}
              </button>
            ) : null}
            {toast.actionLabel ? (
              <button
                type="button"
                className="app-toast-action app-toast-action-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  toast.onAction?.();
                  dismissToast(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="app-toast-close"
        aria-label="Cerrar alerta"
        onClick={(event) => {
          event.stopPropagation();
          dismissToast(toast.id);
        }}
      >
        x
      </button>
    </article>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;

    setToasts((current) => [
      ...current.slice(-3),
      {
        ...toast,
        id,
        tone: toast.tone ?? "info",
      },
    ]);

    return id;
  }, []);

  const confirmToast = useCallback(
    (toast: ConfirmToastInput) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;

      setToasts((current) => [
        ...current.slice(-3),
        {
          id,
          tone: toast.tone ?? "warning",
          title: toast.title,
          message: toast.message,
          actionLabel: toast.confirmLabel ?? "Confirmar",
          secondaryActionLabel: toast.cancelLabel ?? "Cancelar",
          persistent: true,
          onAction: toast.onConfirm,
          onSecondaryAction: () => undefined,
          onClick: undefined,
        },
      ]);

      return id;
    },
    [],
  );

  const value = useMemo(
    () => ({ showToast, confirmToast, dismissToast }),
    [confirmToast, dismissToast, showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="app-toast-viewport" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} dismissToast={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast debe usarse dentro de ToastProvider.");
  }
  return context;
}
