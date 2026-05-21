import { useCallback, useEffect, useState } from "react";
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

export function useSession() {
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("checking");
    setError(null);
    const { data, error: err, status: httpStatus } = await apiGet<MeResponse>("/me");
    if (err || !data?.user) {
      setUser(null);
      setEmail("");
      setStatus("guest");
      if (err && httpStatus !== 401) setError(err.message);
      return;
    }
    setUser(data.user);
    setEmail(typeof data.email === "string" ? data.email : "");
    setStatus("authed");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, user, email, error, refresh };
}
