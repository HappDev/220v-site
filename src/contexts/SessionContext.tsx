import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGet } from "@/lib/api";

export type SessionUser = {
  plan: string;
  tariff?: string;
  status?: string;
  devicesLimit: number;
  currentDevices?: number;
  usedDays: number;
  expireAt: string;
  daysLeft: number;
  username: string;
  userUuid?: string;
  subscriptionUrl?: string;
  shortUuid?: string;
  usedTrafficBytes?: number;
  trafficLimitBytes?: number;
};

export type SessionStatus = "checking" | "authed" | "guest";

type MeResponse = {
  exists: boolean;
  user: SessionUser;
  email?: string;
};

type SessionContextValue = {
  status: SessionStatus;
  user: SessionUser | null;
  email: string;
  error: string | null;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const { data, error: err, status: httpStatus } = await apiGet<MeResponse>("/me");
    if (err || !data?.user) {
      if (httpStatus === 401) {
        setUser(null);
        setEmail("");
        setStatus("guest");
        return;
      }

      setError(err?.message ?? "Не удалось проверить сессию");
      setStatus((prev) => (prev === "authed" ? "authed" : "guest"));
      return;
    }

    setUser(data.user);
    setEmail(typeof data.email === "string" ? data.email : "");
    setStatus("authed");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      status,
      user,
      email,
      error,
      refresh,
    }),
    [status, user, email, error, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
