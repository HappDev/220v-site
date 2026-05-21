import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
import { setVpnPendingRedirect } from "@/lib/vpnStorage";

export default function RequireVpnAuth({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  useEffect(() => {
    if (status === "guest" && location.pathname && location.pathname !== "/") {
      const target = `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
      setVpnPendingRedirect(target);
    }
  }, [status, location]);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-label="Загрузка" />
      </div>
    );
  }

  if (status === "guest") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
