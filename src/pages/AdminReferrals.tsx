import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, GitBranch } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import AdminPageShell from "@/components/AdminPageShell";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
};

type ReferrerUserLookup = {
  loading: boolean;
  email?: string | null;
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
  return item.reason || "—";
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

function WarningList({ warnings }: { warnings: ReferralWarning[] }) {
  if (warnings.length === 0) {
    return <span className="text-xs text-muted-foreground">Без warning-ов</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {warnings.map((warning) => (
        <Badge key={warning.code} className={cn("border", riskClass(warning.severity))}>
          {warning.label}
        </Badge>
      ))}
    </div>
  );
}

function ReferrerTable({ items, eventType, token }: { items: ReferrerRisk[]; eventType: string; token: string }) {
  const [userLookups, setUserLookups] = useState<Record<string, ReferrerUserLookup>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyUuid, setHistoryUuid] = useState("");
  const [historyData, setHistoryData] = useState<ReferralPointsResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

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
        setUserLookups((prev) => ({ ...prev, [uuid]: { loading: false, email } }));
      } catch (err) {
        setUserLookups((prev) => ({ ...prev, [uuid]: { loading: false, error: asErrorMessage(err) } }));
      }
    },
    [token, userLookups],
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

  const selectedUserLookup = historyUuid ? userLookups[historyUuid] : null;

  return (
    <>
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Рефереры с риском</h2>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">По выбранным фильтрам ничего не найдено</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Реферер</TableHead>
                <TableHead>Риск</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Воронка</TableHead>
                <TableHead>Unique</TableHead>
                <TableHead>Warning-и</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const visibleEvents =
                  eventType === "all" ? item.events : item.events.filter((event) => event.type === eventType);
                return (
                  <TableRow key={item.referrerUuid}>
                    <TableCell colSpan={7} className="p-0">
                      <details
                        className="group"
                        onToggle={(event) => {
                          if (event.currentTarget.open) void loadUserEmail(item.referrerUuid);
                        }}
                      >
                        <summary className="grid cursor-pointer list-none grid-cols-1 gap-3 p-4 text-sm hover:bg-muted/50 md:grid-cols-[minmax(210px,1.5fr)_110px_80px_minmax(170px,1fr)_minmax(150px,1fr)_minmax(220px,1.5fr)_130px] [&::-webkit-details-marker]:hidden">
                          <span className="flex min-w-0 items-start gap-2 text-foreground">
                            <ChevronRight
                              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                              aria-hidden="true"
                            />
                            <span className="min-w-0 break-all font-mono text-xs font-semibold">
                              {item.referrerUuid}
                            </span>
                          </span>
                          <span>
                            <RiskBadge level={item.riskLevel} />
                          </span>
                          <span className="font-bold text-foreground">{item.riskScore}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.counts.clicks}/{item.counts.codes}/{item.counts.verifies}/{item.counts.checkouts}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            IP {item.unique.ipHashes} · UA {item.unique.userAgentHashes} · FP{" "}
                            {item.unique.fingerprintHashes}
                          </span>
                          <WarningList warnings={item.warnings} />
                          <span className="text-xs text-muted-foreground">{formatDate(item.lastSeen)}</span>
                        </summary>
                        <div className="border-t border-border bg-muted/20 p-4">
                          <div className="mb-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                            <div className="break-all">
                              Email:{" "}
                              {userLookups[item.referrerUuid]?.loading
                                ? "загрузка..."
                                : userLookups[item.referrerUuid]?.error ||
                                  userLookups[item.referrerUuid]?.email ||
                                  "—"}
                            </div>
                            <div>Email hashes: {item.unique.referredEmailHashes}</div>
                            <div>User prefixes: {item.unique.referredUuidPrefixes}</div>
                            <div>Credit skipped: {item.counts.creditSkipped}</div>
                          </div>
                          <div className="mb-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                              onClick={() => openReferralHistory(item.referrerUuid)}
                            >
                              История
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
              <div className="space-y-1 break-all">
                <p>UUID: {historyUuid || "—"}</p>
                {selectedUserLookup?.email ? <p>Email: {selectedUserLookup.email}</p> : null}
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
                      <TableCell className="break-all text-xs">{item.referred_user_email || "—"}</TableCell>
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
  const didAutoLoad = useRef(false);

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
    } catch (err) {
      setError(asErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [eventType, limit, period, token]);

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

  return (
    <AdminPageShell
      eyebrow="Referral Risk Monitor"
      title="Реферальная статистика из Redis"
      description="Воронка, top hashes и backend warning-и по подозрению на накрутку."
      icon={GitBranch}
      token={token}
      onTokenChange={setToken}
      onReset={() => setSummary(null)}
      onRefresh={load}
      loading={loading}
      error={error}
      updatedAt={summary?.generatedAt}
    >
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="grid gap-3 md:grid-cols-[160px_140px_160px_1fr_180px]">
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

          <ReferrerTable items={filteredReferrers} eventType={eventType} token={token} />

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
