import { type FormEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, GitBranch, Info, SlidersHorizontal } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import AdminPageShell from "@/components/AdminPageShell";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ADMIN_TOKEN_STORAGE_KEY } from "@/lib/admin";
import { apiBase } from "@/lib/api";
import { formatUserError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";

type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

type CounterEntry = { key: string; count: number };

type ReferralCounts = {
  clicks: number;
  codes: number;
  verifies: number;
  checkouts: number;
  creditSkipped: number;
  selfReferrals: number;
};

type ReferralEvent = {
  id?: string;
  type?: string;
  at?: string;
  referrerUuid?: string;
  referredEmailHash?: string;
  referredUuidPrefix?: string;
  ipHash?: string;
  uaHash?: string;
  fingerprintHash?: string;
  otherUserUuidPrefix?: string;
  selfReferral?: boolean;
  path?: string;
  reason?: string;
  tariffKey?: string;
};

type ReferralWarning = {
  code: string;
  label: string;
  severity: RiskLevel;
  evidence: Record<string, unknown>;
};

type ReferralUserStatus = {
  penalized: boolean;
  pointsBlocked: boolean;
  penalizedAt?: string | null;
  pointsBlockedAt?: string | null;
  lastDebitAt?: string | null;
  lastDebitAmount?: number | null;
  lastDebitComment?: string | null;
  updatedAt?: string | null;
};

type DailyRegistration = {
  date: string;
  registrations: number;
  suspicious: number;
};

type ReferrerRisk = {
  referrerUuid: string;
  riskLevel: RiskLevel;
  riskScore: number;
  warnings: ReferralWarning[];
  counts: ReferralCounts;
  unique: {
    ipHashes: number;
    userAgentHashes: number;
    fingerprintHashes: number;
    referredEmailHashes: number;
    referredUuidPrefixes: number;
  };
  lastSeen?: string | null;
  events: ReferralEvent[];
  status?: ReferralUserStatus;
};

type ReferrerUserLookup = {
  loading: boolean;
  email?: string | null;
  status?: ReferralUserStatus;
  error?: string;
};

type ReferrerBalanceLookup = {
  loading: boolean;
  balance?: number | null;
  error?: string;
};

type ReferralPointItem = {
  id: number | string;
  amount: number;
  reason: string;
  referred_user_email?: string | null;
  meta?: {
    tier?: string;
    tariff_key?: string;
    is_first?: boolean;
    trigger?: string;
    comment?: string;
    days?: number;
  } | null;
  created_at: string;
};

type ReferralPointsResponse = {
  balance: number;
  items: ReferralPointItem[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  eligibility?: {
    active: boolean;
    reason: string | null;
  } | null;
};

type DebitReferralPointsResponse = {
  transaction?: ReferralPointItem;
  balance?: number;
  status?: ReferralUserStatus;
};

type ReferralExchangeRequest = {
  id: string;
  referrerUuid: string;
  email?: string | null;
  type: "days" | "prize";
  points: number;
  status: "pending" | "approved" | "rejected";
  operatorComment?: string | null;
  payload?: {
    days?: number;
    prizeId?: string;
    prizeTitle?: string;
    details?: string;
  };
  createdAt?: string | null;
  closedAt?: string | null;
};

type ReferralExchangeRequestsResponse = {
  items: ReferralExchangeRequest[];
};

type ReferralExchangeActionResponse = {
  request?: ReferralExchangeRequest;
  debit?: {
    balance?: number;
  };
  exchange?: {
    balance?: number;
  };
};

type ReferralSummary = {
  generatedAt: string;
  window: { days: number | null; since: string | null; until: string };
  totals: {
    events: number;
    referrers: number;
    suspiciousReferrers: number;
    criticalHighWarnings: number;
    selfReferrals: number;
    multiAccountDetections: number;
  };
  funnel: ReferralCounts;
  riskSummary: Record<RiskLevel, number>;
  referrers: ReferrerRisk[];
  topIps: CounterEntry[];
  topUserAgents: CounterEntry[];
  topFingerprints: CounterEntry[];
  dailyRegistrations: DailyRegistration[];
  events: ReferralEvent[];
};

const RISK_LABELS: Record<RiskLevel, string> = {
  critical: "Критичный",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  none: "Нет",
};

const RISK_REFERRERS_GRID_CLASS =
  "grid grid-cols-1 gap-2 lg:grid-cols-[minmax(145px,1.2fr)_72px_120px_125px_92px_118px] lg:items-center";

const EVENT_LABELS: Record<string, string> = {
  ref_click: "Переход",
  ref_send_code: "Код",
  ref_verify_ok: "Регистрация",
  ref_checkout_by_referred: "Checkout",
  ref_credit_skipped: "Пропуск",
  ref_self_referral: "Self-referral",
};

const EVENT_FILTERS = [
  { value: "all", label: "Все события" },
  { value: "ref_click", label: "Переходы" },
  { value: "ref_send_code", label: "Коды" },
  { value: "ref_verify_ok", label: "Регистрации" },
  { value: "ref_checkout_by_referred", label: "Checkout" },
  { value: "ref_credit_skipped", label: "Пропуски" },
  { value: "ref_self_referral", label: "Self-referral" },
];

const HISTORY_PAGE_SIZE = 20;
const DEFAULT_EXCHANGE_APPROVE_COMMENT = "Обмен баллов пользователем";
const DEFAULT_EXCHANGE_REJECT_COMMENT = "Отклонено оператором";

const DAILY_REGISTRATIONS_CHART_CONFIG = {
  registrations: {
    label: "Регистрации",
    color: "hsl(var(--primary))",
  },
  suspicious: {
    label: "Подозрительные",
    color: "hsl(var(--destructive))",
  },
} satisfies ChartConfig;

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
}

function asErrorMessage(error: unknown) {
  return formatUserError(error, "Не удалось загрузить данные");
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function formatReferralPointReason(item: ReferralPointItem): string {
  if (item.reason === "registration") return "Регистрация реферала";
  if (item.reason === "tariff_payment") {
    const tier = item.meta?.tier;
    const tierLabel =
      tier === "1m" ? "1 мес." : tier === "6m" ? "6 мес." : tier === "12m" ? "12 мес." : null;
    const suffix = tierLabel ? ` (${tierLabel})` : "";
    const first = item.meta?.is_first ? " — первая оплата" : "";
    return `Оплата тарифа реферала${suffix}${first}`;
  }
  if (item.reason === "manual_debit") {
    const comment = item.meta?.comment?.trim();
    return comment ? `Списание баллов: ${comment}` : "Списание баллов";
  }
  if (item.reason === "exchange_for_days" || item.reason === "referral_exchange_days") {
    return "Обмен баллов на дни";
  }
  const comment = item.meta?.comment?.trim();
  if (comment) return comment;
  return item.reason || "—";
}

function formatExchangeRequestKind(request: ReferralExchangeRequest): string {
  if (request.type === "days") {
    return `Дни подписки${Number.isInteger(request.payload?.days) ? `: ${request.payload?.days}` : ""}`;
  }
  return request.payload?.prizeTitle || "Приз";
}

function formatExchangeRequestDetails(request: ReferralExchangeRequest): string {
  if (request.type === "days") {
    return "Оператор вручную добавляет дни подписки после одобрения.";
  }
  return request.payload?.details || "Данные получения не указаны";
}

function hasReferralStatus(status?: ReferralUserStatus | null): status is ReferralUserStatus {
  return Boolean(status?.penalized || status?.pointsBlocked);
}

function ReferralStatusBadges({ status }: { status?: ReferralUserStatus | null }) {
  if (!hasReferralStatus(status)) return null;

  return (
    <span className="inline-flex flex-wrap gap-1">
      {status.penalized ? (
        <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-700">
          Оштрафован
        </Badge>
      ) : null}
      {status.pointsBlocked ? (
        <Badge variant="destructive">
          Заблокирован
        </Badge>
      ) : null}
    </span>
  );
}

function formatChartDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function riskClass(level: RiskLevel) {
  if (level === "critical") return "border-red-600 bg-red-600 text-white";
  if (level === "high") return "border-orange-500 bg-orange-500 text-white";
  if (level === "medium") return "border-amber-500 bg-amber-100 text-amber-900";
  if (level === "low") return "border-emerald-500 bg-emerald-50 text-emerald-800";
  return "border-border bg-muted text-muted-foreground";
}

function riskDotClass(level: RiskLevel) {
  if (level === "critical") return "border-red-700 bg-red-600";
  if (level === "high") return "border-orange-600 bg-orange-500";
  if (level === "medium") return "border-amber-600 bg-amber-400";
  if (level === "low") return "border-emerald-600 bg-emerald-500";
  return "border-muted-foreground bg-muted";
}

function riskLevelForScore(score: number): RiskLevel {
  if (score >= 90) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  if (score > 0) return "low";
  return "none";
}

function shortenUuid(value: string) {
  if (value.length <= 20) return value;
  return `${value.slice(0, 9)}...${value.slice(-8)}`;
}

async function copyToClipboard(value: string, label: string) {
  const text = value.trim();
  if (!text || text === "—") return;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!copied) throw new Error("copy failed");
    }
    toast.success(`${label} скопирован`);
  } catch {
    toast.error(`Не удалось скопировать ${label.toLowerCase()}`);
  }
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function RiskBadge({ level }: { level: RiskLevel }) {
  return <Badge className={cn("border", riskClass(level))}>{RISK_LABELS[level] || level}</Badge>;
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge className={cn("min-w-10 justify-center border font-bold", riskClass(riskLevelForScore(score)))}>
      {score}
    </Badge>
  );
}

function CopyableText({
  value,
  label,
  displayValue = value,
  className,
}: {
  value: string;
  label: string;
  displayValue?: string;
  className?: string;
}) {
  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void copyToClipboard(value, label);
  };

  return (
    <button
      type="button"
      title={`${value} — нажмите, чтобы скопировать`}
      className={cn(
        "inline-block max-w-full min-w-0 truncate text-left align-bottom font-mono text-xs font-semibold text-foreground underline-offset-2 transition hover:text-primary hover:underline",
        className,
      )}
      onClick={handleCopy}
    >
      {displayValue}
    </button>
  );
}

function CounterList({ title, items }: { title: string; items: CounterEntry[] }) {
  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет данных</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
              <span className="min-w-0 truncate font-mono text-xs text-foreground">{item.key}</span>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                {item.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DailyRegistrationsChart({ data }: { data: DailyRegistration[] }) {
  const totalRegistrations = data.reduce((sum, item) => sum + item.registrations, 0);
  const totalSuspicious = data.reduce((sum, item) => sum + item.suspicious, 0);

  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Регистрации рефералов по дням</h2>
          <p className="text-sm text-muted-foreground">
            Подозрительные — регистрации от рефереров с риском medium и выше.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Всего: {totalRegistrations}</Badge>
          <Badge className="bg-destructive text-destructive-foreground">Подозрительные: {totalSuspicious}</Badge>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет регистраций за выбранный период</p>
      ) : (
        <ChartContainer config={DAILY_REGISTRATIONS_CHART_CONFIG} className="h-[130px] w-full">
          <LineChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatChartDate} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => (typeof value === "string" ? formatChartDate(value) : value)}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="registrations"
              stroke="var(--color-registrations)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="suspicious"
              stroke="var(--color-suspicious)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      )}
    </section>
  );
}

function EventCard({ event }: { event: ReferralEvent }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs font-bold text-foreground">
          {EVENT_LABELS[event.type || ""] || event.type || "event"}
        </p>
        <span className="text-xs text-muted-foreground">{formatDate(event.at)}</span>
      </div>
      <p className="mt-1 break-all text-xs text-muted-foreground">
        referrer: {event.referrerUuid || "—"} · user: {event.referredUuidPrefix || "—"} · email hash:{" "}
        {event.referredEmailHash || "—"}
      </p>
      <p className="mt-1 break-all text-xs text-muted-foreground">
        ip: {event.ipHash || "—"} · ua: {event.uaHash || "—"} · fp: {event.fingerprintHash || "—"}
      </p>
      {(event.reason || event.tariffKey || event.selfReferral) && (
        <p className="mt-1 text-xs text-muted-foreground">
          reason: {event.reason || "—"} · tariff: {event.tariffKey || "—"} · self:{" "}
          {event.selfReferral ? "yes" : "no"}
        </p>
      )}
    </div>
  );
}

function ColumnHeaderHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1">
          {label}
          <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 text-left text-xs font-normal leading-snug">{children}</TooltipContent>
    </Tooltip>
  );
}

function WarningList({ warnings }: { warnings: ReferralWarning[] }) {
  if (warnings.length === 0) {
    return <span className="text-xs text-muted-foreground">Без warning-ов</span>;
  }
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-nowrap items-center gap-1.5">
        {warnings.map((warning) => (
          <Tooltip key={warning.code}>
            <TooltipTrigger asChild>
              <span
                aria-label={warning.label}
                className={cn("h-3.5 w-3.5 shrink-0 rounded-full border shadow-sm", riskDotClass(warning.severity))}
              />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium">{warning.label}</p>
              <p className="font-mono text-xs opacity-75">{warning.code}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

function ReferrerTable({
  items,
  eventType,
  token,
  filtersPanel,
}: {
  items: ReferrerRisk[];
  eventType: string;
  token: string;
  filtersPanel: ReactNode;
}) {
  const [userLookups, setUserLookups] = useState<Record<string, ReferrerUserLookup>>({});
  const [balanceLookups, setBalanceLookups] = useState<Record<string, ReferrerBalanceLookup>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyUuid, setHistoryUuid] = useState("");
  const [historyData, setHistoryData] = useState<ReferralPointsResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [debitOpen, setDebitOpen] = useState(false);
  const [debitUuid, setDebitUuid] = useState("");
  const [debitAmount, setDebitAmount] = useState("");
  const [debitComment, setDebitComment] = useState("");
  const [debitPointsBlocked, setDebitPointsBlocked] = useState(false);
  const [debitLoading, setDebitLoading] = useState(false);
  const [debitError, setDebitError] = useState("");
  const [statusOverrides, setStatusOverrides] = useState<Record<string, ReferralUserStatus>>({});
  const filtersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!filtersOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filtersOpen]);

  const loadUserEmail = useCallback(
    async (uuid: string) => {
      const existing = userLookups[uuid];
      if (existing?.loading || existing?.email !== undefined || existing?.error) return;

      setUserLookups((prev) => ({ ...prev, [uuid]: { loading: true } }));
      try {
        const res = await fetch(`${apiBase}/admin/referrals/users/${encodeURIComponent(uuid)}`, {
          headers: { "X-Admin-Token": token.trim() },
          credentials: "include",
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `Ошибка ${res.status}`;
          throw new Error(message);
        }
        const email =
          body && typeof body === "object" && "email" in body && typeof body.email === "string"
            ? body.email
            : null;
        const status =
          body && typeof body === "object" && "status" in body && body.status && typeof body.status === "object"
            ? (body.status as ReferralUserStatus)
            : undefined;
        setUserLookups((prev) => ({ ...prev, [uuid]: { loading: false, email, status } }));
      } catch (err) {
        setUserLookups((prev) => ({ ...prev, [uuid]: { loading: false, error: asErrorMessage(err) } }));
      }
    },
    [token, userLookups],
  );

  const loadUserBalance = useCallback(
    async (uuid: string) => {
      const existing = balanceLookups[uuid];
      if (existing?.loading || existing?.balance !== undefined || existing?.error) return;

      setBalanceLookups((prev) => ({ ...prev, [uuid]: { loading: true } }));
      try {
        const qs = new URLSearchParams({
          page: "1",
          limit: "1",
        });
        const res = await fetch(
          `${apiBase}/admin/referrals/users/${encodeURIComponent(uuid)}/points?${qs}`,
          {
            headers: { "X-Admin-Token": token.trim() },
            credentials: "include",
          },
        );
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `Ошибка ${res.status}`;
          throw new Error(message);
        }
        const balance =
          body && typeof body === "object" && "balance" in body && typeof body.balance === "number"
            ? body.balance
            : null;
        setBalanceLookups((prev) => ({ ...prev, [uuid]: { loading: false, balance } }));
      } catch (err) {
        setBalanceLookups((prev) => ({ ...prev, [uuid]: { loading: false, error: asErrorMessage(err) } }));
      }
    },
    [balanceLookups, token],
  );

  const loadReferralHistory = useCallback(
    async (uuid: string, pageNum = 1) => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const qs = new URLSearchParams({
          page: String(pageNum),
          limit: String(HISTORY_PAGE_SIZE),
        });
        const res = await fetch(
          `${apiBase}/admin/referrals/users/${encodeURIComponent(uuid)}/points?${qs}`,
          {
            headers: { "X-Admin-Token": token.trim() },
            credentials: "include",
          },
        );
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `Ошибка ${res.status}`;
          throw new Error(message);
        }
        setHistoryData(body as ReferralPointsResponse);
      } catch (err) {
        setHistoryError(asErrorMessage(err));
      } finally {
        setHistoryLoading(false);
      }
    },
    [token],
  );

  const openReferralHistory = useCallback(
    (uuid: string) => {
      setHistoryUuid(uuid);
      setHistoryData(null);
      setHistoryOpen(true);
      void loadReferralHistory(uuid, 1);
    },
    [loadReferralHistory],
  );

  const openDebitDialog = useCallback((uuid: string) => {
    setDebitUuid(uuid);
    setDebitAmount("");
    setDebitComment("");
    setDebitPointsBlocked(false);
    setDebitError("");
    setDebitOpen(true);
  }, []);

  const submitDebitPoints = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const amountText = debitAmount.trim();
      const amount = Number(amountText);
      const comment = debitComment.trim();
      const statusOnly = !amountText && !comment;

      if (!statusOnly && (!Number.isInteger(amount) || amount <= 0)) {
        setDebitError("Укажите положительное целое число баллов");
        return;
      }
      if (!statusOnly && !comment) {
        setDebitError("Укажите причину списания");
        return;
      }

      setDebitLoading(true);
      setDebitError("");
      try {
        const res = await fetch(`${apiBase}/admin/referrals/users/${encodeURIComponent(debitUuid)}/points/debit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Token": token.trim(),
          },
          credentials: "include",
          body: JSON.stringify(
            statusOnly
              ? { pointsBlocked: debitPointsBlocked }
              : { amount, comment, force: true, pointsBlocked: debitPointsBlocked },
          ),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `Ошибка ${res.status}`;
          throw new Error(message);
        }
        const data = body as DebitReferralPointsResponse;
        if (statusOnly) {
          toast.success(
            debitPointsBlocked
              ? "Начисление реферальных баллов заблокировано"
              : "Начисление реферальных баллов разблокировано",
          );
        } else {
          toast.success(`Списано ${amount} баллов. Новый баланс: ${data.balance ?? "—"}`);
        }
        if (typeof data.balance === "number") {
          setBalanceLookups((prev) => ({ ...prev, [debitUuid]: { loading: false, balance: data.balance } }));
        }
        if (data.status) {
          setStatusOverrides((prev) => ({ ...prev, [debitUuid]: data.status as ReferralUserStatus }));
          setUserLookups((prev) => ({
            ...prev,
            [debitUuid]: {
              ...(prev[debitUuid] || { loading: false }),
              loading: false,
              status: data.status,
            },
          }));
        }
        setDebitOpen(false);
        if (!statusOnly && historyUuid === debitUuid) {
          void loadReferralHistory(debitUuid, historyData?.page || 1);
        }
      } catch (err) {
        setDebitError(asErrorMessage(err));
      } finally {
        setDebitLoading(false);
      }
    },
    [debitAmount, debitComment, debitPointsBlocked, debitUuid, historyData?.page, historyUuid, loadReferralHistory, token],
  );

  const selectedUserLookup = historyUuid ? userLookups[historyUuid] : null;
  const selectedDebitLookup = debitUuid ? userLookups[debitUuid] : null;

  return (
    <>
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Рефереры с риском</h2>
          </div>
          <div ref={filtersRef} className="relative">
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={filtersOpen}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted"
                    onClick={() => setFiltersOpen((open) => !open)}
                  >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    Фильтры
                  </button>
                </TooltipTrigger>
                <TooltipContent>Период, limit и уровень риска</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {filtersOpen ? (
              <div
                role="dialog"
                aria-label="Фильтры рефереров с риском"
                className="absolute right-0 z-30 mt-2 w-[min(92vw,520px)] rounded-xl border border-border bg-card p-4 shadow-xl"
              >
                <div className="grid gap-3 sm:grid-cols-3">{filtersPanel}</div>
              </div>
            ) : null}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">По выбранным фильтрам ничего не найдено</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead colSpan={6} className="h-auto p-0">
                  <TooltipProvider delayDuration={150}>
                    <div className={cn(RISK_REFERRERS_GRID_CLASS, "px-3 py-3")}>
                      <span>Реферер</span>
                      <ColumnHeaderHint label="Score">
                        <p className="font-medium">Балл риска</p>
                        <p>Сумма очков за все сработавшие сигналы. Чем больше балл, тем подозрительнее реферер. Очки за сигналы:</p>
                        <ul className="ml-3 list-disc space-y-0.5">
                          <li>регистрация после открытия ссылки из браузера/ПК другого аккаунта: +100</li>
                          <li>общий IP-хэш у разных рефералов: +90</li>
                          <li>общий fingerprint-хэш у разных рефералов: +90</li>
                          <li>≥5 регистраций без единой оплаты: +70</li>
                          <li>один IP-хэш часто при кодах/регистрациях: +55</li>
                          <li>один fingerprint-хэш часто при кодах/регистрациях: +55</li>
                          <li>≥2 пропущенных реферальных начисления: +35</li>
                          <li>повтор User-Agent / fingerprint без оплат: +30</li>
                        </ul>
                        <p className="opacity-75">Если сигналов нет, но события есть — базовый балл 5.</p>
                      </ColumnHeaderHint>
                      <ColumnHeaderHint label="Воронка">
                        <p className="font-medium">Воронка переходов</p>
                        <p>
                          Формат <span className="font-mono">клики / коды / регистрации / оплаты</span>. Показывает, сколько пользователей
                          дошло до каждого шага: переход по ссылке → ввод кода → подтверждение (регистрация) → оплата (checkout).
                        </p>
                      </ColumnHeaderHint>
                      <ColumnHeaderHint label="Unique">
                        <p className="font-medium">Уникальные идентификаторы</p>
                        <p>
                          Число различных технических отпечатков среди рефералов: <span className="font-mono">IP</span> — уникальные хэши
                          IP-адресов, <span className="font-mono">UA</span> — уникальные хэши User-Agent, <span className="font-mono">FP</span>{" "}
                          — уникальные fingerprint-хэши.
                        </p>
                        <p className="opacity-75">Низкое разнообразие при большом числе рефералов — признак накрутки одним человеком.</p>
                      </ColumnHeaderHint>
                      <span>Warning-и</span>
                      <span>Last seen</span>
                    </div>
                  </TooltipProvider>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const visibleEvents =
                  eventType === "all" ? item.events : item.events.filter((event) => event.type === eventType);
                const itemStatus =
                  statusOverrides[item.referrerUuid] || userLookups[item.referrerUuid]?.status || item.status;
                return (
                  <TableRow key={item.referrerUuid}>
                    <TableCell colSpan={6} className="p-0">
                      <details
                        className="group"
                        onToggle={(event) => {
                          if (event.currentTarget.open) {
                            void loadUserEmail(item.referrerUuid);
                            void loadUserBalance(item.referrerUuid);
                          }
                        }}
                      >
                        <summary
                          className={cn(
                            RISK_REFERRERS_GRID_CLASS,
                            "cursor-pointer list-none p-3 text-sm hover:bg-muted/50 [&::-webkit-details-marker]:hidden",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2 text-foreground">
                            <ChevronRight
                              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                              aria-hidden="true"
                            />
                            <CopyableText
                              value={item.referrerUuid}
                              label="UUID"
                              displayValue={shortenUuid(item.referrerUuid)}
                            />
                            <ReferralStatusBadges status={itemStatus} />
                          </span>
                          <span>
                            <ScoreBadge score={item.riskScore} />
                          </span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {item.counts.clicks}/{item.counts.codes}/{item.counts.verifies}/{item.counts.checkouts}
                          </span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            IP {item.unique.ipHashes} · UA {item.unique.userAgentHashes} · FP{" "}
                            {item.unique.fingerprintHashes}
                          </span>
                          <WarningList warnings={item.warnings} />
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDate(item.lastSeen)}
                          </span>
                        </summary>
                        <div className="border-t border-border bg-muted/20 p-4">
                          <div className="mb-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-5">
                            <div className="min-w-0">
                              Email:{" "}
                              {userLookups[item.referrerUuid]?.loading ? (
                                "загрузка..."
                              ) : userLookups[item.referrerUuid]?.email ? (
                                <CopyableText
                                  value={userLookups[item.referrerUuid]?.email || ""}
                                  label="Email"
                                  className="align-baseline"
                                />
                              ) : (
                                userLookups[item.referrerUuid]?.error || "—"
                              )}
                            </div>
                            <div>
                              Баллы:{" "}
                              {balanceLookups[item.referrerUuid]?.loading
                                ? "загрузка..."
                                : balanceLookups[item.referrerUuid]?.balance ?? balanceLookups[item.referrerUuid]?.error ?? "—"}
                            </div>
                            <div>Email hashes: {item.unique.referredEmailHashes}</div>
                            <div>User prefixes: {item.unique.referredUuidPrefixes}</div>
                            <div>Credit skipped: {item.counts.creditSkipped}</div>
                          </div>
                          {hasReferralStatus(itemStatus) ? (
                            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <ReferralStatusBadges status={itemStatus} />
                              {itemStatus.penalizedAt ? <span>Штраф: {formatDate(itemStatus.penalizedAt)}</span> : null}
                              {itemStatus.pointsBlockedAt ? (
                                <span>Блокировка начислений: {formatDate(itemStatus.pointsBlockedAt)}</span>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="mb-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                              onClick={() => openReferralHistory(item.referrerUuid)}
                            >
                              История
                            </button>
                            <button
                              type="button"
                              className="rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground transition hover:bg-destructive/90"
                              onClick={() => openDebitDialog(item.referrerUuid)}
                            >
                              Списать баллы
                            </button>
                          </div>
                          {item.warnings.length > 0 && (
                            <div className="mb-3 space-y-2">
                              {item.warnings.map((warning) => (
                                <div key={warning.code} className="rounded-lg bg-background p-3 ring-1 ring-border">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <RiskBadge level={warning.severity} />
                                    <span className="font-semibold text-foreground">{warning.label}</span>
                                    <span className="font-mono text-xs text-muted-foreground">{warning.code}</span>
                                  </div>
                                  <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs text-muted-foreground">
                                    {JSON.stringify(warning.evidence, null, 2)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="space-y-2">
                            {visibleEvents.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Нет событий выбранного типа</p>
                            ) : (
                              visibleEvents.map((event, index) => (
                                <EventCard key={event.id || `${event.at}-${index}`} event={event} />
                              ))
                            )}
                          </div>
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>История рефералов</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                <p>
                  UUID:{" "}
                  {historyUuid ? (
                    <CopyableText value={historyUuid} label="UUID" displayValue={shortenUuid(historyUuid)} />
                  ) : (
                    "—"
                  )}
                </p>
                {selectedUserLookup?.email ? (
                  <p>
                    Email: <CopyableText value={selectedUserLookup.email} label="Email" />
                  </p>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>

          {historyLoading && !historyData ? (
            <p className="text-sm text-muted-foreground">Загрузка истории...</p>
          ) : historyError ? (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{historyError}</p>
          ) : !historyData || historyData.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">История рефералов пустая</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">Баланс: {historyData.balance ?? 0}</Badge>
                <Badge variant="secondary">Всего записей: {historyData.total ?? historyData.items.length}</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Событие</TableHead>
                    <TableHead>Реферал</TableHead>
                    <TableHead>Баллы</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyData.items.map((item, index) => (
                    <TableRow key={item.id || `${item.created_at}-${index}`}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(item.created_at)}</TableCell>
                      <TableCell className="text-xs">{formatReferralPointReason(item)}</TableCell>
                      <TableCell className="text-xs">
                        {item.referred_user_email ? (
                          <CopyableText value={item.referred_user_email} label="Email" className="max-w-[220px]" />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs font-bold",
                          item.amount >= 0 ? "text-emerald-600" : "text-destructive",
                        )}
                      >
                        {formatAmount(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {historyData && historyData.total_pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={historyData.page <= 1 || historyLoading}
                onClick={() => void loadReferralHistory(historyUuid, historyData.page - 1)}
              >
                Назад
              </button>
              <span className="text-sm text-muted-foreground">
                Страница {historyData.page} из {historyData.total_pages}
              </span>
              <button
                type="button"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={historyData.page >= historyData.total_pages || historyLoading}
                onClick={() => void loadReferralHistory(historyUuid, historyData.page + 1)}
              >
                Вперёд
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={debitOpen} onOpenChange={setDebitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Списать реферальные баллы</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1">
                <p>
                  UUID:{" "}
                  {debitUuid ? (
                    <CopyableText value={debitUuid} label="UUID" displayValue={shortenUuid(debitUuid)} />
                  ) : (
                    "—"
                  )}
                </p>
                {selectedDebitLookup?.email ? (
                  <p>
                    Email: <CopyableText value={selectedDebitLookup.email} label="Email" />
                  </p>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={submitDebitPoints}>
            <label className="block text-sm font-semibold text-foreground">
              Количество баллов
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={debitAmount}
                onChange={(event) => setDebitAmount(event.target.value)}
                placeholder="Например, 10"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                disabled={debitLoading}
              />
            </label>
            <label className="block text-sm font-semibold text-foreground">
              Причина списания
              <Textarea
                value={debitComment}
                onChange={(event) => setDebitComment(event.target.value)}
                placeholder="Например: накрутка рефералов, ручная корректировка"
                disabled={debitLoading}
                className="mt-1"
              />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">
              <Checkbox
                checked={debitPointsBlocked}
                onCheckedChange={(checked) => setDebitPointsBlocked(checked === true)}
                disabled={debitLoading}
                className="mt-0.5"
              />
              <span>
                <span className="block font-semibold">Заблокировать начисление реферальных баллов</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Пользователь будет помечен как заблокированный и больше не сможет получать баллы в
                  реферальной системе.
                </span>
              </span>
            </label>
            {debitError ? (
              <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{debitError}</p>
            ) : null}
            <DialogFooter>
              <button
                type="button"
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={debitLoading}
                onClick={() => setDebitOpen(false)}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={debitLoading}
              >
                {debitLoading ? "Списываем..." : "Списать"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminReferrals() {
  const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "");
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"7" | "30" | "all">("30");
  const [limit, setLimit] = useState("5000");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [eventType, setEventType] = useState("all");
  const [referrerFilter, setReferrerFilter] = useState("");
  const [exchangeRequests, setExchangeRequests] = useState<ReferralExchangeRequest[]>([]);
  const [exchangeRequestsLoading, setExchangeRequestsLoading] = useState(false);
  const [exchangeRequestsError, setExchangeRequestsError] = useState("");
  const [exchangeActionId, setExchangeActionId] = useState("");
  const [exchangeComments, setExchangeComments] = useState<Record<string, string>>({});
  const didAutoLoad = useRef(false);

  const loadExchangeRequests = useCallback(async (adminToken = token.trim()) => {
    const trimmedToken = adminToken.trim();
    if (!trimmedToken) return;
    setExchangeRequestsLoading(true);
    setExchangeRequestsError("");
    try {
      const res = await fetch(`${apiBase}/admin/referrals/exchange-requests?status=pending`, {
        headers: { "X-Admin-Token": trimmedToken },
        credentials: "include",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `Ошибка ${res.status}`;
        throw new Error(message);
      }
      const data = body as ReferralExchangeRequestsResponse;
      setExchangeRequests(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setExchangeRequestsError(asErrorMessage(err));
    } finally {
      setExchangeRequestsLoading(false);
    }
  }, [token]);

  const load = useCallback(async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("Введите ADMIN_REDIS_TOKEN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        days: period,
        limit: String(Math.max(1, Math.min(20000, Number(limit) || 5000))),
      });
      const res = await fetch(`${apiBase}/admin/referrals/summary?${qs}`, {
        headers: { "X-Admin-Token": trimmedToken },
        credentials: "include",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `Ошибка ${res.status}`;
        throw new Error(message);
      }
      setSummary(body as ReferralSummary);
      localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmedToken);
      void loadExchangeRequests(trimmedToken);
    } catch (err) {
      setError(asErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [limit, loadExchangeRequests, period, token]);

  const processExchangeRequest = useCallback(
    async (requestId: string, action: "approve" | "reject") => {
      const trimmedToken = token.trim();
      if (!trimmedToken) {
        setExchangeRequestsError("Введите ADMIN_REDIS_TOKEN");
        return;
      }
      setExchangeActionId(requestId);
      setExchangeRequestsError("");
      try {
        const typedComment = (exchangeComments[requestId] || "").trim();
        const comment =
          typedComment || (action === "approve" ? DEFAULT_EXCHANGE_APPROVE_COMMENT : DEFAULT_EXCHANGE_REJECT_COMMENT);
        const res = await fetch(`${apiBase}/admin/referrals/exchange-requests/${encodeURIComponent(requestId)}/${action}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Token": trimmedToken,
          },
          credentials: "include",
          body: JSON.stringify({ comment }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `Ошибка ${res.status}`;
          throw new Error(message);
        }
        const data = body as ReferralExchangeActionResponse;
        if (action === "approve") {
          toast.success(`Заявка одобрена. Баланс: ${data.exchange?.balance ?? data.debit?.balance ?? "—"}`);
        } else {
          toast.success("Заявка отклонена");
        }
        setExchangeComments((prev) => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
        await loadExchangeRequests(trimmedToken);
      } catch (err) {
        setExchangeRequestsError(asErrorMessage(err));
      } finally {
        setExchangeActionId("");
      }
    },
    [exchangeComments, loadExchangeRequests, token],
  );

  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    if (token) void load();
  }, [load, token]);

  const filteredReferrers = useMemo(() => {
    if (!summary) return [];
    const refNeedle = referrerFilter.trim().toLowerCase();
    return summary.referrers.filter((item) => {
      if (riskFilter !== "all" && item.riskLevel !== riskFilter) return false;
      if (refNeedle && !item.referrerUuid.toLowerCase().includes(refNeedle)) return false;
      if (eventType !== "all" && !item.events.some((event) => event.type === eventType)) return false;
      return true;
    });
  }, [eventType, referrerFilter, riskFilter, summary]);

  const filteredEvents = useMemo(() => {
    if (!summary) return [];
    if (eventType === "all") return summary.events;
    return summary.events.filter((event) => event.type === eventType);
  }, [eventType, summary]);

  const riskFiltersPanel = (
    <>
      <label className="text-sm font-semibold text-foreground">
        Период
        <select
          value={period}
          onChange={(event) => setPeriod(event.target.value as "7" | "30" | "all")}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="7">7 дней</option>
          <option value="30">30 дней</option>
          <option value="all">Весь Redis TTL</option>
        </select>
      </label>
      <label className="text-sm font-semibold text-foreground">
        Limit
        <input
          type="number"
          min="1"
          max="20000"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <label className="text-sm font-semibold text-foreground">
        Риск
        <select
          value={riskFilter}
          onChange={(event) => setRiskFilter(event.target.value as RiskLevel | "all")}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">Все уровни</option>
          <option value="critical">Критичный</option>
          <option value="high">Высокий</option>
          <option value="medium">Средний</option>
          <option value="low">Низкий</option>
          <option value="none">Нет</option>
        </select>
      </label>
    </>
  );

  return (
    <AdminPageShell
      eyebrow="Referral Risk Monitor"
      title="Реферальная статистика из Redis"
      description="Воронка, top hashes и backend warning-и по подозрению на накрутку."
      icon={GitBranch}
      token={token}
      onTokenChange={setToken}
      onReset={() => {
        setSummary(null);
        setExchangeRequests([]);
        setExchangeRequestsError("");
        setExchangeActionId("");
        setExchangeComments({});
        setError("");
      }}
      onRefresh={load}
      loading={loading}
      error={error}
      updatedAt={summary?.generatedAt}
    >
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <label className="text-sm font-semibold text-foreground">
            Referrer UUID
            <input
              value={referrerFilter}
              onChange={(event) => setReferrerFilter(event.target.value)}
              placeholder="Фильтр по UUID"
              className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="text-sm font-semibold text-foreground">
            Тип события
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {EVENT_FILTERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-lg font-bold text-foreground">Активные заявки на обмен</h2>
            <p className="text-sm text-muted-foreground">
              Операторы вручную выдают дни или призы, затем одобряют заявку для списания баллов.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void loadExchangeRequests()}
            disabled={exchangeRequestsLoading || !token.trim()}
          >
            {exchangeRequestsLoading ? "Обновляем..." : "Обновить"}
          </button>
        </div>
        {exchangeRequestsError ? (
          <p className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{exchangeRequestsError}</p>
        ) : null}
        {exchangeRequestsLoading && exchangeRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Загрузка заявок...</p>
        ) : exchangeRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Активных заявок нет</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Создана</TableHead>
                  <TableHead>Пользователь</TableHead>
                  <TableHead>Заявка</TableHead>
                  <TableHead>Детали</TableHead>
                  <TableHead>Баллы</TableHead>
                  <TableHead>Комментарий</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exchangeRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDate(request.createdAt)}</TableCell>
                    <TableCell className="text-xs">
                      <div className="space-y-1">
                        <CopyableText value={request.referrerUuid} label="UUID" displayValue={shortenUuid(request.referrerUuid)} />
                        {request.email ? <CopyableText value={request.email} label="Email" className="max-w-[220px]" /> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-semibold">{formatExchangeRequestKind(request)}</TableCell>
                    <TableCell className="max-w-[280px] whitespace-pre-wrap text-xs text-muted-foreground">
                      {formatExchangeRequestDetails(request)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-bold">{request.points}</TableCell>
                    <TableCell className="min-w-[220px]">
                      <Textarea
                        value={exchangeComments[request.id] || ""}
                        onChange={(event) =>
                          setExchangeComments((prev) => ({ ...prev, [request.id]: event.target.value }))
                        }
                        placeholder="Комментарий оператора"
                        disabled={exchangeActionId === request.id}
                        className="min-h-20 text-xs"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(exchangeActionId)}
                          onClick={() => void processExchangeRequest(request.id, "approve")}
                        >
                          {exchangeActionId === request.id ? "..." : "Одобрить"}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(exchangeActionId)}
                          onClick={() => void processExchangeRequest(request.id, "reject")}
                        >
                          Отклонить
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <StatCard label="События" value={summary.totals.events} />
            <StatCard label="Рефереры" value={summary.totals.referrers} />
            <StatCard label="Подозрительные" value={summary.totals.suspiciousReferrers} />
            <StatCard label="Critical/High" value={summary.totals.criticalHighWarnings} />
            <StatCard label="Self-referrals" value={summary.totals.selfReferrals} />
            <StatCard label="Multi-account" value={summary.totals.multiAccountDetections} />
          </div>

          <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-lg font-bold text-foreground">Воронка и риск</h2>
              {(Object.keys(RISK_LABELS) as RiskLevel[]).map((level) => (
                <Badge key={level} className={cn("border", riskClass(level))}>
                  {RISK_LABELS[level]}: {summary.riskSummary[level] || 0}
                </Badge>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Clicks", summary.funnel.clicks],
                ["Codes", summary.funnel.codes],
                ["Verifies", summary.funnel.verifies],
                ["Checkouts", summary.funnel.checkouts],
                ["Skipped", summary.funnel.creditSkipped],
                ["Self", summary.funnel.selfReferrals],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-xs uppercase text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <DailyRegistrationsChart data={summary.dailyRegistrations || []} />

          <ReferrerTable items={filteredReferrers} eventType={eventType} token={token} filtersPanel={riskFiltersPanel} />

          <div className="grid gap-5 lg:grid-cols-3">
            <CounterList title="Top IP hashes" items={summary.topIps} />
            <CounterList title="Top User-Agent hashes" items={summary.topUserAgents} />
            <CounterList title="Top Fingerprint hashes" items={summary.topFingerprints} />
          </div>

          <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-foreground">Последние события</h2>
              <Badge variant="secondary">{filteredEvents.length}</Badge>
            </div>
            {filteredEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет событий выбранного типа</p>
            ) : (
              <div className="space-y-2">
                {filteredEvents.map((event, index) => (
                  <EventCard key={event.id || `${event.at}-${index}`} event={event} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </AdminPageShell>
  );
}
