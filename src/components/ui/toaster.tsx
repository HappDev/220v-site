import * as React from "react";

import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { pinSafariThemeColor } from "@/lib/themeColor";

export function Toaster() {
  const { toasts } = useToast();
  const hasOpenToast = toasts.some((toast) => toast.open !== false);

  React.useEffect(() => {
    if (!hasOpenToast) return;

    pinSafariThemeColor();
    const intervalId = window.setInterval(pinSafariThemeColor, 300);
    return () => window.clearInterval(intervalId);
  }, [hasOpenToast]);

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
