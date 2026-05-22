import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CreditCard,
  Gauge,
  LifeBuoy,
  MoreHorizontal,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiPost } from "@/lib/api";
import { useSession } from "@/hooks/useSession";
import {
  clearChatCompatCache,
  getVpnTalkmeProfileRaw,
} from "@/lib/vpnStorage";
import type { DashboardSidebarItem } from "@/components/DashboardSidebar";

type SidebarUser = {
  userUuid: string | null;
  isPremium: boolean;
};

const PAID_TARIFF_CODES = new Set(["1month", "6month", "12month"]);
const PAID_PLAN_LABELS = new Set(["1 месяц", "6 месяцев", "12 месяцев"]);

export const SIDEBAR_SHOW_OTHER = false;

function resolveIsPremium(user: unknown): boolean {
  if (!user || typeof user !== "object") return false;
  const raw = user as Record<string, unknown>;
  const tariff = typeof raw.tariff === "string" ? raw.tariff.toLowerCase() : "";
  const plan = typeof raw.plan === "string" ? raw.plan.toLowerCase() : "";
  return (
    PAID_TARIFF_CODES.has(tariff) ||
    plan === "premium" ||
    PAID_PLAN_LABELS.has(plan)
  );
}

function readCachedIsPremium(): boolean {
  try {
    const raw = getVpnTalkmeProfileRaw();
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return resolveIsPremium(parsed);
  } catch {
    return false;
  }
}

export type DashboardSidebarData = {
  email: string | null;
  items: DashboardSidebarItem[];
  handleLogout: () => void;
  userUuid: string | null;
  userLoading: boolean;
  userError: string | null;
};

export function useDashboardSidebarItems(): DashboardSidebarData {
  const navigate = useNavigate();
  const { status: sessionStatus, email, user: sessionUser, refresh: refreshSession } = useSession();
  const [userInfo, setUserInfo] = useState<SidebarUser>(() => ({
    userUuid: sessionUser?.userUuid ?? null,
    isPremium: readCachedIsPremium() || resolveIsPremium(sessionUser),
  }));
  const [userLoading, setUserLoading] = useState(sessionStatus === "checking");
  const [userError, setUserError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus !== "authed") return;

    let cancelled = false;
    setUserLoading(true);
    setUserError(null);
    (async () => {
      try {
        const { data, error } = await apiGet<{ user?: unknown }>("/me");
        if (cancelled) return;
        if (error) {
          setUserError(error.message ?? "Не удалось получить данные");
          return;
        }
        const user = (data as { user?: unknown } | null)?.user;
        const uuidCandidate =
          user && typeof user === "object"
            ? (user as Record<string, unknown>).userUuid
            : null;
        setUserInfo({
          userUuid: typeof uuidCandidate === "string" ? uuidCandidate : null,
          isPremium: resolveIsPremium(user),
        });
      } catch (err) {
        if (!cancelled) {
          setUserError(err instanceof Error ? err.message : "Ошибка загрузки данных");
        }
      } finally {
        if (!cancelled) setUserLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionStatus]);

  const handleLogout = async () => {
    await apiPost("/auth/logout");
    clearChatCompatCache();
    await refreshSession();
    navigate("/");
  };

  const items = useMemo<DashboardSidebarItem[]>(() => {
    const list: DashboardSidebarItem[] = [
      {
        key: "subscription",
        label: "Моя подписка",
        icon: CreditCard,
        onClick: () => navigate("/dashboard"),
        primary: true,
        match: "/dashboard",
      },
      {
        key: "tariff",
        label: "Купить тариф",
        icon: ShoppingCart,
        onClick: () => navigate("/tariff"),
        match: "/tariff",
      },
    ];

    if (userInfo.isPremium) {
      list.push({
        key: "traffic",
        label: "Купить трафик",
        icon: Gauge,
        onClick: () => navigate("/traffic"),
        match: "/traffic",
      });
    }

    list.push(
      {
        key: "instructions",
        label: "Инструкции",
        icon: BookOpen,
        onClick: () => navigate("/instructions"),
        match: "/instructions",
      },
      {
        key: "support",
        label: "Поддержка",
        icon: LifeBuoy,
        onClick: () => navigate("/chat"),
        match: ["/support", "/chat"],
      },
      {
        key: "other",
        label: "Другое",
        icon: MoreHorizontal,
        onClick: () => toast.info("Раздел скоро переедет на отдельную страницу"),
      },
    );

    return list.filter((item) => item.key !== "other" || SIDEBAR_SHOW_OTHER);
  }, [navigate, userInfo.isPremium]);

  return {
    email: email || null,
    items,
    handleLogout,
    userUuid: userInfo.userUuid,
    userLoading,
    userError,
  };
}

export default useDashboardSidebarItems;
