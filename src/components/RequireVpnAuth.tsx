import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import {
  getVpnAuthEmail,
  setVpnPendingRedirect,
  VPN_STORAGE_KEY_PREFIX,
} from "@/lib/vpnStorage";

type AuthStatus = "checking" | "authed" | "guest";

export default function RequireVpnAuth({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    const sync = () => {
      if (cancelled) return;
      setStatus(getVpnAuthEmail() ? "authed" : "guest");
    };

    sync();
    const timer = window.setTimeout(sync, 0);
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== localStorage) return;
      if (e.key !== null && !e.key.startsWith(VPN_STORAGE_KEY_PREFIX)) return;
      sync();
    };

    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-label="Загрузка" />
      </div>
    );
  }

  if (status === "guest") {
    // Не сохраняем корень как pending — там и так логин-экран.
    if (location.pathname && location.pathname !== "/") {
      const target = `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
      setVpnPendingRedirect(target);
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
