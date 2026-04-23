import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Crown,
  Smartphone,
  CalendarClock,
  Trash2,
  Loader2,
  Activity,
  HelpCircle,
  Gift,
  Tag,
  Info,
  LogOut,
  Send,
  Download,
  Link2,
  Copy,
  QrCode,
  CreditCard,
  ShoppingCart,
  Gauge,
  BookOpen,
  LifeBuoy,
  MoreHorizontal,
} from "lucide-react";
import { invokeFunction } from "@/lib/api";
import {
  clearVpnAuthAndCaches,
  getVpnAuthEmail,
  getVpnSubscriptionUrl,
  setVpnSubscriptionUrl,
  setVpnTalkmeProfileJson,
  VPN_STORAGE_KEY_PREFIX,
} from "@/lib/vpnStorage";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import InstructionsModal, { oneClickHappUrl, type InstructionsPlatform } from "@/components/InstructionsModal";
import LandingShell from "@/pages/landing/LandingShell";
import LandingFooter from "@/pages/landing/LandingFooter";
import DashboardSidebar, { type DashboardSidebarItem } from "@/components/DashboardSidebar";

interface UserData {
  plan: string;
  /** Код тарифа из RMW: trial | 1month | 6month | 12month */
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
}

interface HwidDevice {
  hwid: string;
  userAgent?: string;
  platform?: string;
  deviceModel?: string;
  osVersion?: string;
  createdAt?: string;
  userUuid?: string;
}

type BillingMeta = {
  payments: { id: number; type: string; label: string }[];
  products: {
    product_key: string;
    tariff_key: string;
    price: number | null;
    duration: string | null;
    traffic_limit_bytes: number | null;
    type: string | null;
  }[];
};

function toSafeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeUserData(value: unknown): UserData | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const plan = toSafeString(raw.plan, "—");
  const username = toSafeString(raw.username, "—");
  if (!plan || !username) return null;

  return {
    plan,
    tariff: toSafeString(raw.tariff, ""),
    status: toSafeString(raw.status, ""),
    devicesLimit: toSafeNumber(raw.devicesLimit, 0),
    currentDevices: toSafeNumber(raw.currentDevices, 0),
    usedDays: toSafeNumber(raw.usedDays, 0),
    expireAt: toSafeString(raw.expireAt, ""),
    daysLeft: toSafeNumber(raw.daysLeft, 0),
    username,
    userUuid: toSafeString(raw.userUuid, ""),
    subscriptionUrl: toSafeString(raw.subscriptionUrl, ""),
    shortUuid: toSafeString(raw.shortUuid, ""),
    usedTrafficBytes: toSafeNumber(raw.usedTrafficBytes, 0),
    trafficLimitBytes: toSafeNumber(raw.trafficLimitBytes, 0),
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

/** Сохраняется при уходе с /dashboard?… без сессии, чтобы после входа открыть тот же deep link */
const DASHBOARD_PENDING_SEARCH_KEY = "vpn_dashboard_pending_search";

const Dashboard = () => {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billingMeta, setBillingMeta] = useState<BillingMeta | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<HwidDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deletingHwid, setDeletingHwid] = useState<string | null>(null);
  const [tariffOpen, setTariffOpen] = useState(false);
  const [trafficInfoOpen, setTrafficInfoOpen] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<number | null>(null);
  const [paymentLoading, setPaymentLoading] = useState<number | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [trafficBuyOpen, setTrafficBuyOpen] = useState(false);
  const [trafficPaymentStep, setTrafficPaymentStep] = useState<{ gb: number; price: number } | null>(null);
  const [otherMenuOpen, setOtherMenuOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [mySubscriptionOpen, setMySubscriptionOpen] = useState(false);
  const [subscriptionQrOpen, setSubscriptionQrOpen] = useState(false);
  const [instructionsInitialPlatform, setInstructionsInitialPlatform] = useState<
    InstructionsPlatform | undefined
  >(undefined);
  const copySubscriptionButtonRef = useRef<HTMLButtonElement>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const openInstructions = useCallback((platform?: InstructionsPlatform) => {
    setInstructionsInitialPlatform(platform);
    setInstructionsOpen(true);
  }, []);

  useEffect(() => {
    const st = location.state as { openInstructions?: boolean } | null;
    if (!st?.openInstructions || loading) return;
    navigate(location.pathname, { replace: true, state: {} });
    if (userData && !error) {
      openInstructions();
    }
  }, [loading, userData, error, location.state, location.pathname, navigate, openInstructions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await invokeFunction<BillingMeta>("billing/meta", {});
      if (cancelled) return;
      if (error) {
        // не блокируем весь дашборд, просто оставим fallback значения ниже
        console.warn("billing/meta failed:", error);
        return;
      }
      if (data && typeof data === "object" && Array.isArray((data as BillingMeta).payments)) {
        setBillingMeta(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const email = getVpnAuthEmail();

  useEffect(() => {
    const syncAuth = () => {
      if (!getVpnAuthEmail()) navigate("/", { replace: true });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== localStorage) return;
      if (e.key !== null && !e.key.startsWith(VPN_STORAGE_KEY_PREFIX)) return;
      syncAuth();
    };
    const onFocusOrVis = () => syncAuth();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocusOrVis);
    document.addEventListener("visibilitychange", onFocusOrVis);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocusOrVis);
      document.removeEventListener("visibilitychange", onFocusOrVis);
    };
  }, [navigate]);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get("support") === "1") {
      navigate("/support", { replace: true });
      return;
    }
    if (!email) {
      if (location.search) {
        try {
          sessionStorage.setItem(DASHBOARD_PENDING_SEARCH_KEY, location.search);
        } catch {
          // ignore
        }
      }
      navigate("/", { replace: true });
      return;
    }

    const fetchUser = async () => {
      try {
        const { data, error: fnError } = await invokeFunction("remnawave-proxy", {
          action: "check-or-create",
          email,
        });

        if (fnError) throw fnError;
        if (data?.user) {
          const normalizedUser = normalizeUserData(data.user);
          if (!normalizedUser) {
            setError("Некорректный формат данных пользователя");
            return;
          }
          if (normalizedUser.subscriptionUrl) {
            setVpnSubscriptionUrl(normalizedUser.subscriptionUrl);
          }
          setVpnTalkmeProfileJson(
            JSON.stringify({
              usedTrafficBytes: normalizedUser.usedTrafficBytes,
              trafficLimitBytes: normalizedUser.trafficLimitBytes,
              expireAt: normalizedUser.expireAt,
              currentDevices: normalizedUser.currentDevices,
              devicesLimit: normalizedUser.devicesLimit,
              tariff: normalizedUser.tariff,
              plan: normalizedUser.plan,
            }),
          );
          setUserData(normalizedUser);
        } else {
          setError(data?.error || "Не удалось получить данные");
        }
      } catch (err: any) {
        setError(err.message || "Ошибка загрузки данных");
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [navigate, email, location.search]);

  const clearDashboardSearch = useCallback(() => {
    if (!location.search) return;
    navigate({ pathname: location.pathname, search: "" }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const fetchDevices = useCallback(async () => {
    if (!userData?.userUuid) return;
    setDevicesLoading(true);
    try {
      const { data, error } = await invokeFunction("remnawave-proxy", {
        action: "get-devices",
        userUuid: userData.userUuid,
      });
      if (!error && data?.devices) {
        setDevices(data.devices);
        const devicesCount = Array.isArray(data.devices) ? data.devices.length : 0;
        setUserData((prev) => {
          if (!prev) return prev;
          const next = { ...prev, currentDevices: toSafeNumber(data.total, devicesCount) };
          setVpnTalkmeProfileJson(
            JSON.stringify({
              usedTrafficBytes: next.usedTrafficBytes,
              trafficLimitBytes: next.trafficLimitBytes,
              expireAt: next.expireAt,
              currentDevices: next.currentDevices,
              devicesLimit: next.devicesLimit,
              tariff: next.tariff,
              plan: next.plan,
            }),
          );
          return next;
        });
      }
    } catch (_e) {
      // ignore
    } finally {
      setDevicesLoading(false);
    }
  }, [userData?.userUuid]);

  useEffect(() => {
    if (loading || error || !userData) return;
    const sp = new URLSearchParams(location.search);
    if (!sp.toString()) return;

    const stripAnd = (fn: () => void) => {
      fn();
      clearDashboardSearch();
    };

    if (sp.get("devices") === "1") {
      stripAnd(() => {
        setDevicesOpen(true);
        void fetchDevices();
      });
      return;
    }
    if (sp.get("subscription") === "1") {
      stripAnd(() => setMySubscriptionOpen(true));
      return;
    }
    const buy = (sp.get("buy") ?? "").toLowerCase();
    if (buy === "tariff") {
      stripAnd(() => {
        setTariffOpen(true);
        setSelectedMonths(null);
      });
      return;
    }
    if (buy === "traffic") {
      stripAnd(() => {
        setTrafficBuyOpen(true);
        setTrafficPaymentStep(null);
      });
      return;
    }
    if (sp.has("instructions")) {
      const raw = (sp.get("instructions") ?? "auto").toLowerCase();
      const valid: InstructionsPlatform[] = [
        "android",
        "ios",
        "windows",
        "linux",
        "appletv",
        "androidtv",
      ];
      stripAnd(() => {
        if (raw !== "auto" && valid.includes(raw as InstructionsPlatform)) {
          setInstructionsInitialPlatform(raw as InstructionsPlatform);
        } else {
          setInstructionsInitialPlatform(undefined);
        }
        setInstructionsOpen(true);
      });
      return;
    }
    if (sp.get("referral") === "1") {
      stripAnd(() => setReferralOpen(true));
      return;
    }
    if (sp.get("promo") === "1") {
      stripAnd(() => setPromoOpen(true));
      return;
    }
    if (sp.get("about") === "1") {
      stripAnd(() => setAboutOpen(true));
      return;
    }
  }, [loading, error, userData, location.search, clearDashboardSearch, fetchDevices]);

  const handleOpenDevices = () => {
    const count = userData?.currentDevices ?? 0;
    if (count === 0) {
      openInstructions();
      return;
    }
    setDevicesOpen(true);
    fetchDevices();
  };

  const handleDeleteDevice = async (hwid: string) => {
    if (!userData?.userUuid) return;
    setDeletingHwid(hwid);
    try {
      const { data, error } = await invokeFunction("remnawave-proxy", {
        action: "delete-device",
        userUuid: userData.userUuid,
        hwid,
      });
      if (!error && data?.success) {
        setDevices((prev) => prev.filter((d) => d.hwid !== hwid));
        setUserData((prev) =>
          prev ? { ...prev, currentDevices: Math.max(0, (prev.currentDevices ?? 0) - 1) } : prev,
        );
      }
    } catch (_e) {
      // ignore
    } finally {
      setDeletingHwid(null);
    }
  };

  const handleSelectTariff = (months: number) => {
    setSelectedMonths(months);
  };

  const paymentMethods =
    billingMeta?.payments?.length
      ? billingMeta.payments
      : [
          { id: 2, type: "sbp", label: "СБП (QR-код)" },
          { id: 11, type: "card", label: "Оплата картой" },
          { id: 13, type: "crypto", label: "Криптовалюта" },
        ];

  const productPriceByKey = new Map(
    (billingMeta?.products ?? [])
      .filter((p) => p && typeof p.product_key === "string")
      .map((p) => [p.product_key, typeof p.price === "number" ? p.price : null]),
  );

  const tariffPriceByMonths: Record<number, number | null> = {
    1: productPriceByKey.get("sub_1m") ?? null,
    6: productPriceByKey.get("sub_6m") ?? null,
    12: productPriceByKey.get("sub_12m") ?? null,
  };

  const tariffProductKey: Record<number, string> = {
    1: "sub_1m",
    6: "sub_6m",
    12: "sub_12m",
  };

  const trafficProductKey: Record<number, string> = {
    20: "traffic_20gb",
    50: "traffic_50gb",
  };

  const handlePayment = async (paymentMethod: number) => {
    if (!selectedMonths) return;
    if (!userData?.userUuid) {
      toast.error("Не найден профиль пользователя. Обновите страницу.");
      return;
    }
    const product_key = tariffProductKey[selectedMonths];
    const allowedPayments = new Set(paymentMethods.map((m) => m.id));
    if (!allowedPayments.has(paymentMethod) || !product_key) {
      toast.error("Некорректные параметры оплаты");
      return;
    }
    setPaymentLoading(paymentMethod);
    try {
      const { data, error: fnError } = await invokeFunction("billing/checkout", {
        userUuid: userData.userUuid,
        product_key,
        payment_method: paymentMethod,
      });
      if (fnError) throw fnError;
      const paymentUrl =
        data && typeof data === "object" && "payment_url" in data && typeof (data as { payment_url: unknown }).payment_url === "string"
          ? (data as { payment_url: string }).payment_url
          : "";
      if (paymentUrl) {
        window.location.href = paymentUrl;
      } else {
        toast.error("Не удалось получить ссылку на оплату");
      }
    } catch (err: any) {
      toast.error(err.message || "Ошибка при создании платежа");
    } finally {
      setPaymentLoading(null);
    }
  };

  const handleTrafficPayment = async (paymentMethod: number) => {
    if (!trafficPaymentStep) return;
    if (!userData?.userUuid) {
      toast.error("Не найден профиль пользователя. Обновите страницу.");
      return;
    }
    const product_key = trafficProductKey[trafficPaymentStep.gb];
    const allowedPayments = new Set(paymentMethods.map((m) => m.id));
    if (!allowedPayments.has(paymentMethod) || !product_key) {
      toast.error("Некорректные параметры оплаты");
      return;
    }
    setPaymentLoading(paymentMethod);
    try {
      const { data, error: fnError } = await invokeFunction("billing/checkout", {
        userUuid: userData.userUuid,
        product_key,
        payment_method: paymentMethod,
      });
      if (fnError) throw fnError;
      const paymentUrl =
        data && typeof data === "object" && "payment_url" in data && typeof (data as { payment_url: unknown }).payment_url === "string"
          ? (data as { payment_url: string }).payment_url
          : "";
      if (paymentUrl) {
        window.location.href = paymentUrl;
      } else {
        toast.error("Не удалось получить ссылку на оплату");
      }
    } catch (err: any) {
      toast.error(err.message || "Ошибка при создании платежа");
    } finally {
      setPaymentLoading(null);
    }
  };

  const handleLogout = () => {
    clearVpnAuthAndCaches();
    navigate("/");
  };

  /** Тот же URL, что в инструкциях у «Скопировать ссылку подписки» (данные пользователя или localStorage). */
  const resolveSubscriptionUrl = () => {
    const fromUser = (userData?.subscriptionUrl ?? "").trim();
    if (fromUser) return fromUser;
    return getVpnSubscriptionUrl();
  };

  /**
   * Копирование в буфер из пользовательского жеста (без async-обёртки — иначе Clipboard API блокируется).
   * Fallback как в InstructionsModal (CopySubscriptionLink): временный input на кнопке + execCommand.
   */
  const handleCopySubscriptionLink = () => {
    const url = resolveSubscriptionUrl();
    if (!url) {
      toast.error("Ссылка подписки недоступна");
      return;
    }

    const copyViaExecCommand = () => {
      const container = copySubscriptionButtonRef.current;
      if (!container) {
        toast.error("Не удалось скопировать");
        return;
      }
      const input = document.createElement("input");
      input.type = "text";
      input.value = url;
      input.style.position = "absolute";
      input.style.opacity = "0";
      input.style.height = "0";
      input.style.fontSize = "16px";
      container.appendChild(input);
      input.focus();
      input.setSelectionRange(0, input.value.length);
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      container.removeChild(input);
      if (ok) {
        toast.success("Ссылка скопирована!", {
          style: { background: "#22c55e", color: "#fff", border: "none" },
        });
      } else {
        toast.error("Не удалось скопировать. Скопируйте вручную:", {
          description: url,
          duration: 8000,
        });
      }
    };

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => {
          toast.success("Ссылка скопирована!", {
            style: { background: "#22c55e", color: "#fff", border: "none" },
          });
        },
        () => {
          copyViaExecCommand();
        },
      );
      return;
    }
    copyViaExecCommand();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const trafficPercent = userData?.trafficLimitBytes
    ? Math.min(100, Math.round(((userData.usedTrafficBytes ?? 0) / userData.trafficLimitBytes) * 100))
    : 0;
  const tariffLc = (userData?.tariff ?? "").toLowerCase();
  const planLc = (userData?.plan ?? "").toLowerCase();
  const paidTariffCodes = new Set(["1month", "6month", "12month"]);
  const paidPlanLabels = ["1 месяц", "6 месяцев", "12 месяцев"];
  const isPremiumPlan =
    paidTariffCodes.has(tariffLc) ||
    planLc === "premium" ||
    paidPlanLabels.includes(planLc);
  const isExpired = (userData?.status ?? "").toUpperCase() === "EXPIRED";
  const isTrafficExhausted = (userData?.trafficLimitBytes ?? 0) > 0 && (userData?.usedTrafficBytes ?? 0) >= (userData?.trafficLimitBytes ?? 0);

  const sidebarItems: DashboardSidebarItem[] = [
    {
      key: "subscription",
      label: "Моя подписка",
      icon: CreditCard,
      onClick: () => setMySubscriptionOpen(true),
      primary: true,
    },
    {
      key: "tariff",
      label: "Купить тариф",
      icon: ShoppingCart,
      onClick: () => setTariffOpen(true),
    },
    ...(isPremiumPlan
      ? ([
          {
            key: "traffic",
            label: "Купить трафик",
            icon: Gauge,
            onClick: () => {
              setTrafficBuyOpen(true);
              setTrafficPaymentStep(null);
            },
          },
        ] as DashboardSidebarItem[])
      : []),
    {
      key: "instructions",
      label: "Инструкции",
      icon: BookOpen,
      onClick: () => openInstructions(),
    },
    {
      key: "support",
      label: "Поддержка",
      icon: LifeBuoy,
      onClick: () => navigate("/support"),
    },
    {
      key: "other",
      label: "Другое",
      icon: MoreHorizontal,
      onClick: () => setOtherMenuOpen(true),
    },
  ];

  if (loading) {
    return (
      <LandingShell className="landing-root--with-sidebar">
        <DashboardSidebar items={[]} onLogout={handleLogout} />
        <main className="app-page">
          <div className="container">
            <div className="app-page__notice">
              <p>Загружаем ваш личный кабинет и данные подписки.</p>
              <div className="app-page__meta">Пожалуйста, подождите…</div>
            </div>
          </div>
        </main>
        <LandingFooter />
      </LandingShell>
    );
  }

  if (error) {
    return (
      <LandingShell className="landing-root--with-sidebar">
        <DashboardSidebar items={[]} onLogout={handleLogout} />
        <main className="app-page">
          <div className="container">
            <div className="app-page__notice">
              <p>{error}</p>
              <button type="button" className="btn btn--primary" onClick={handleLogout}>
                Назад
              </button>
            </div>
          </div>
        </main>
        <LandingFooter />
      </LandingShell>
    );
  }

  return (
    <LandingShell className="landing-root--with-sidebar">
      <DashboardSidebar items={sidebarItems} onLogout={handleLogout} email={email || undefined} />

      <main>
        <section className="app-page">
          <div className="container">
            <div className="app-page__hero app-page__hero--dashboard">
              <div className="app-page__panel">
                <div className="app-page__eyebrow">Личный кабинет 220v</div>
                <h1 className="app-page__title">Управляйте подпиской, устройствами и трафиком в одном месте.</h1>
                <p className="app-page__subtitle">
                  Здесь собраны ключевые данные по вашему тарифу, подключённым устройствам и доступу к сервису.
                </p>
                <div className="app-page__meta">{email}</div>

                <div className="app-grid app-grid--stats">
                  <div className={`app-stat ${isExpired ? "app-stat--danger" : ""}`}>
                    <Crown className={`h-6 w-6 ${isExpired ? "text-red-400" : "text-[#c6ff3d]"}`} />
                    <span className="app-stat__label">Тариф</span>
                    <span className="app-stat__value">{isExpired ? "Истёк" : userData?.plan}</span>
                  </div>
                  <div className={`app-stat ${isExpired ? "app-stat--danger" : ""}`}>
                    <CalendarClock className={`h-6 w-6 ${isExpired ? "text-red-400" : "text-[#c6ff3d]"}`} />
                    <span className="app-stat__label">Дата истечения</span>
                    <span className="app-stat__value">{userData?.expireAt ? formatDate(userData.expireAt) : "—"}</span>
                  </div>
                </div>

                <button type="button" onClick={handleOpenDevices} className="app-action">
                  <div className="app-action__row">
                    <div className="app-action__info">
                      <Smartphone className="h-5 w-5 text-[#c6ff3d]" />
                      <span className="app-action__label">Устройства</span>
                    </div>
                    <span className="app-action__value">
                      {userData?.currentDevices ?? 0} / {userData?.devicesLimit ?? 0}
                    </span>
                  </div>
                  <p className="app-action__hint">
                    {(userData?.currentDevices ?? 0) > 0
                      ? "Нажмите, чтобы посмотреть и отредактировать список."
                      : "Добавьте первое устройство через инструкции по подключению."}
                  </p>
                </button>

                <div className={`app-progress ${isTrafficExhausted ? "app-progress--danger" : ""}`}>
                  <div className="app-progress__row">
                    <div className="app-progress__info">
                      <Activity className={`h-5 w-5 ${isTrafficExhausted ? "text-red-400" : "text-[#c6ff3d]"}`} />
                      <span className="app-progress__label">Трафик</span>
                    </div>
                    <span className="app-progress__meta">
                      {formatBytes(userData?.usedTrafficBytes ?? 0)} / {formatBytes(userData?.trafficLimitBytes ?? 0)}
                    </span>
                  </div>
                  <div className="app-progress__track">
                    <div className="app-progress__bar" style={{ width: `${trafficPercent}%` }} />
                  </div>
                  <div className="app-progress__row">
                    <button type="button" onClick={() => setTrafficInfoOpen(true)} className="app-progress__link">
                      Подробнее
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                    <span className="app-progress__meta">{trafficPercent}%</span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />

      {/* Devices Modal */}
      <Dialog open={devicesOpen} onOpenChange={setDevicesOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Подключённые устройства</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">Список HWID устройств, подключённых к вашему аккаунту.</span>
              <span className="block text-foreground">
                Внимание: удаление устройства не лишает его доступа к аккаунту — так вы освобождаете слот для другого
                устройства. Если необходимо ограничить доступ с других устройств, смените ссылку подключения в меню
                «Другое».
              </span>
            </DialogDescription>
          </DialogHeader>

          {devicesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : devices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Нет подключённых устройств</p>
          ) : (
            <div className="flex flex-col gap-3 divide-y divide-border">
              {devices.map((device) => (
                <div
                  key={device.hwid}
                  className="flex items-start justify-between gap-3 rounded-lg bg-muted p-3 pt-4 first:pt-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">HWID: {device.hwid || "—"}</p>
                    {device.platform && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {device.platform} {device.osVersion} — {device.deviceModel}
                      </p>
                    )}
                    {device.userAgent && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">{device.userAgent}</p>
                    )}
                    {device.createdAt && (
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(device.createdAt)}</p>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={deletingHwid === device.hwid}
                    onClick={() => handleDeleteDevice(device.hwid)}
                  >
                    {deletingHwid === device.hwid ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Tariff Selection Modal */}
      <Dialog
        open={tariffOpen}
        onOpenChange={(open) => {
          setTariffOpen(open);
          if (!open) setSelectedMonths(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{selectedMonths ? "Выберите способ оплаты" : "Выберите срок тарифа"}</DialogTitle>
            <DialogDescription>
              {selectedMonths
                ? `Подписка на ${selectedMonths} мес. — ${tariffPriceByMonths[selectedMonths] ?? "—"} ₽`
                : "Выберите подходящий период подписки"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            {!selectedMonths ? (
              [
                { months: 1, label: "1 месяц", price: tariffPriceByMonths[1] },
                { months: 6, label: "6 месяцев", price: tariffPriceByMonths[6] },
                { months: 12, label: "12 месяцев", price: tariffPriceByMonths[12] },
              ].map((opt) => (
                <Button
                  key={opt.months}
                  variant="outline"
                  className="w-full justify-between py-6 text-base font-semibold group"
                  onClick={() => handleSelectTariff(opt.months)}
                >
                  <span>{opt.label}</span>
                  <span className="text-primary group-hover:text-white">{opt.price ?? "—"} ₽</span>
                </Button>
              ))
            ) : (
              <>
                <Button variant="ghost" size="sm" className="mb-1 w-fit" onClick={() => setSelectedMonths(null)}>
                  ← Назад
                </Button>
                {paymentMethods.map((method) => (
                  <Button
                    key={method.id}
                    variant="outline"
                    className="w-full justify-center py-6 text-base font-semibold"
                    disabled={paymentLoading !== null}
                    onClick={() => handlePayment(method.id)}
                  >
                    {paymentLoading === method.id ? <Loader2 className="h-5 w-5 animate-spin" /> : method.label}
                  </Button>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* My subscription */}
      <Dialog
        open={mySubscriptionOpen}
        onOpenChange={(open) => {
          setMySubscriptionOpen(open);
          if (!open) setSubscriptionQrOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Моя подписка</DialogTitle>
            <DialogDescription>Управление подключением в приложении Happ</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              variant="outline"
              className="w-full justify-center gap-2 py-6 text-base font-semibold"
              onClick={() => openInstructions()}
            >
              <Download className="h-5 w-5" />
              Скачать приложение
            </Button>
            <Button
              variant="outline"
              className="w-full justify-center gap-2 py-6 text-base font-semibold"
              disabled={!resolveSubscriptionUrl()}
              onClick={() => {
                const url = resolveSubscriptionUrl();
                if (!url) {
                  toast.error("Ссылка подписки недоступна");
                  return;
                }
                window.location.href = oneClickHappUrl(url);
              }}
            >
              <Link2 className="h-5 w-5" />
              Добавить подписку в приложение
            </Button>
            <Button
              ref={copySubscriptionButtonRef}
              variant="outline"
              className="w-full justify-center gap-2 py-6 text-base font-semibold"
              disabled={!resolveSubscriptionUrl()}
              onClick={handleCopySubscriptionLink}
            >
              <Copy className="h-5 w-5" />
              Скопировать подписку
            </Button>
            <Button
              variant="outline"
              className="w-full justify-center gap-2 py-6 text-base font-semibold"
              disabled={!resolveSubscriptionUrl()}
              onClick={() => {
                const url = resolveSubscriptionUrl();
                if (!url) {
                  toast.error("Ссылка подписки недоступна");
                  return;
                }
                setSubscriptionQrOpen(true);
              }}
            >
              <QrCode className="h-5 w-5" />
              QR-Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={subscriptionQrOpen} onOpenChange={setSubscriptionQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>QR-Code подписки</DialogTitle>
            <DialogDescription>
              Откройте приложение Happ, нажмите кнопку QR-Code в правом нижнем углу и отскануйте данный код.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const qrUrl = resolveSubscriptionUrl();
            if (!qrUrl) {
              return <p className="pt-2 text-sm text-muted-foreground">Ссылка подписки недоступна</p>;
            }
            return (
              <div className="flex flex-col items-center gap-3 pt-2">
                <div className="rounded-xl bg-white p-4 ring-1 ring-border">
                  <img
                    alt="QR-Code"
                    className="h-52 w-52"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrUrl)}`}
                  />
                </div>
                <Button variant="outline" className="w-full" onClick={() => setSubscriptionQrOpen(false)}>
                  Закрыть
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Instructions Modal */}
      <InstructionsModal
        open={instructionsOpen}
        onOpenChange={(open) => {
          setInstructionsOpen(open);
          if (!open) setInstructionsInitialPlatform(undefined);
        }}
        subscriptionUrl={resolveSubscriptionUrl() || undefined}
        initialPlatform={instructionsInitialPlatform}
      />

      {/* Traffic Info Modal */}
      <Dialog open={trafficInfoOpen} onOpenChange={setTrafficInfoOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Информация о трафике</DialogTitle>
            <DialogDescription>
              Трафик тарифицируется только на LTE-серверах. На всех остальных он безлимитный.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* Buy Traffic Modal */}
      <Dialog
        open={trafficBuyOpen}
        onOpenChange={(open) => {
          setTrafficBuyOpen(open);
          if (!open) setTrafficPaymentStep(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{trafficPaymentStep ? "Выберите способ оплаты" : "Купить трафик"}</DialogTitle>
            <DialogDescription>
              {trafficPaymentStep
                ? `${trafficPaymentStep.gb} ГБ — ${trafficPaymentStep.price} ₽`
                : "Выберите пакет трафика"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            {!trafficPaymentStep ? (
              [
                { gb: 20, price: productPriceByKey.get("traffic_20gb") ?? null },
                { gb: 50, price: productPriceByKey.get("traffic_50gb") ?? null },
              ].map((opt) => (
                <Button
                  key={opt.gb}
                  variant="outline"
                  className="w-full justify-between py-6 text-base font-semibold group"
                  onClick={() => {
                    if (typeof opt.price !== "number") {
                      toast.error("Не удалось загрузить цену пакета");
                      return;
                    }
                    setTrafficPaymentStep({ gb: opt.gb, price: opt.price });
                  }}
                >
                  <span>{opt.gb} ГБ</span>
                  <span className="text-primary group-hover:text-white">{opt.price ?? "—"} ₽</span>
                </Button>
              ))
            ) : (
              <>
                <Button variant="ghost" size="sm" className="mb-1 w-fit" onClick={() => setTrafficPaymentStep(null)}>
                  ← Назад
                </Button>
                {paymentMethods.map((method) => (
                  <Button
                    key={method.id}
                    variant="outline"
                    className="w-full justify-center py-6 text-base font-semibold"
                    disabled={paymentLoading !== null}
                    onClick={() => handleTrafficPayment(method.id)}
                  >
                    {paymentLoading === method.id ? <Loader2 className="h-5 w-5 animate-spin" /> : method.label}
                  </Button>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Other Menu Modal */}
      <Dialog open={otherMenuOpen} onOpenChange={setOtherMenuOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Другое</DialogTitle>
            <DialogDescription>Выберите действие</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 py-5 text-base"
              onClick={() => {
                setOtherMenuOpen(false);
                setReferralOpen(true);
              }}
            >
              <Gift className="h-5 w-5 text-primary" /> Реферальная программа
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 py-5 text-base"
              onClick={() => {
                setOtherMenuOpen(false);
                setPromoOpen(true);
              }}
            >
              <Tag className="h-5 w-5 text-primary" /> Промокод
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 py-5 text-base"
              onClick={() => {
                setOtherMenuOpen(false);
                setAboutOpen(true);
              }}
            >
              <Info className="h-5 w-5 text-primary" /> О нас
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 py-5 text-base"
              onClick={() => {
                setOtherMenuOpen(false);
                window.open("https://t.me/vpn220v_bot", "_blank", "noopener,noreferrer");
              }}
            >
              <Send className="h-5 w-5 text-primary" /> Telegram-бот
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-start gap-3 py-5 text-base hover:bg-red-900"
              onClick={handleLogout}
            >
              <LogOut className="h-5 w-5" /> Выход
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Referral Modal */}
      <Dialog open={referralOpen} onOpenChange={setReferralOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Реферальная программа</DialogTitle>
            <DialogDescription>Бонусные дни за друга, коллегу, родственника</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2 text-sm text-foreground">
            <p>
              За каждого, кто зарегистрировался по вашей ссылке и оплатил подписку, вы получите{" "}
              <span className="font-bold text-primary">+7 дней</span> на ваш аккаунт!
            </p>
            <div className="rounded-lg bg-card p-4 ring-1 ring-border">
              <p className="mb-2 text-xs text-muted-foreground">Ваша уникальная ссылка:</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText("Ссылка временно недоступна");
                  toast.success("Ссылка скопирована!");
                }}
                className="w-full break-all rounded-md bg-primary/10 px-3 py-2 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                Ссылка временно недоступна
              </button>
              <p className="mt-2 text-xs text-muted-foreground text-center">(нажмите, чтобы скопировать)</p>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Сколько зарегистрированных по вашей ссылке: <span className="font-bold text-foreground">0</span>
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Promo Code Modal */}
      <Dialog open={promoOpen} onOpenChange={setPromoOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Промокод</DialogTitle>
            <DialogDescription>Введите промокод чтобы активировать бонусы</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Введите промокод"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <Button className="w-full" onClick={() => toast.info("Промокод можно активировать в Telegram-боте")}>
              Активировать
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* About Us Modal */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>О нас</DialogTitle>
            <DialogDescription className="sr-only">
              220v — быстрый и безопасный VPN. Условия, скорость, безопасность сервиса.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 pt-2 text-sm text-foreground">
            <p className="text-base font-semibold leading-snug">220v — быстрый и безопасный VPN</p>

            <div>
              <p className="mb-2 text-base font-bold">📋 Условия и возможности:</p>
              <ul className="ml-4 list-disc space-y-2 text-muted-foreground">
                <li>
                  <span className="font-semibold text-foreground">Трафик:</span> 100 ГБ на серверах для мобильного
                  интернета и полный безлимит на всех остальных локациях.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Гибкость:</span> Пользуйтесь одним аккаунтом
                  одновременно на 7 устройствах.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Выгода:</span> На тарифах 6 и 12 месяцев купленный
                  дополнительный трафик для мобильных серверов не сгорает и переносится на следующий месяц.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Доступность:</span> Прозрачные тарифы, бесплатный
                  тест-драйв и старт в один клик.
                </li>
              </ul>
            </div>

            <div>
              <p className="mb-2 text-base font-bold">🚀 Скорость и технологии:</p>
              <ul className="ml-4 list-disc space-y-2 text-muted-foreground">
                <li>Потоковое видео в 4K и загрузка до 1 Гбит/с.</li>
                <li>Прямые каналы через европейские дата-центры для минимального пинга.</li>
                <li>Работа на базе самых современных сетевых протоколов.</li>
              </ul>
            </div>

            <div>
              <p className="mb-2 text-base font-bold">🔐 Безопасность и этика:</p>
              <ul className="ml-4 list-disc space-y-2 text-muted-foreground">
                <li>
                  <span className="font-semibold text-foreground">Строгая политика No-Logs:</span> мы не храним историю
                  ваших действий.
                </li>
                <li>Мощное шифрование и полная защита от утечек данных.</li>
                <li>Никакого спама, баннеров и слежки — только чистый интернет.</li>
                <li>Команда заботы, готовая прийти на помощь 24/7.</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full text-sm">
                  Условия использования
                </Button>
              </a>
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full text-sm">
                  Пользовательское соглашение
                </Button>
              </a>
              <a href="/policy" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full text-sm">
                  Политика конфиденциальности
                </Button>
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </LandingShell>
  );
};

export default Dashboard;
