import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Database, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { apiBase } from "@/lib/api";
import { Button } from "@/components/ui/button";

type CounterEntry = { key: string; count: number };

type ExpiringEntry = {
  key: string;
  ttlSec: number;
  expiresAt: string | null;
};

type OtpEntry = ExpiringEntry & {
  emailMasked: string;
  emailHash: string;
  tries: number;
};

type CooldownEntry = ExpiringEntry & {
  emailMasked: string;
  emailHash: string;
};

type SessionEntry = ExpiringEntry & {
  emailMasked: string;
  emailHash: string;
  userUuidPrefix: string;
  expAt: string | null;
};

type RateLimitEntry = ExpiringEntry & {
  subject: string;
  count: number;
};

type AuthEvent = {
  id?: string;
  type?: string;
  at?: string;
  ip?: string;
  userAgent?: string;
  emailMasked?: string;
  emailHash?: string;
  userUuidPrefix?: string;
  status?: string;
  detail?: string;
};

type RedisAuthSnapshot = {
  generatedAt: string;
  totals: {
    otp: number;
    cooldowns: number;
    sessions: number;
    rateLimits: number;
    events: number;
  };
  otp: OtpEntry[];
  cooldowns: CooldownEntry[];
  sessions: SessionEntry[];
  rateLimits: {
    sendCodeIp: RateLimitEntry[];
    sendCodeEmail: RateLimitEntry[];
    verifyIp: RateLimitEntry[];
    checkoutSession: RateLimitEntry[];
  };
  stats: {
    byType: CounterEntry[];
    byIp: CounterEntry[];
    byEmailHash: CounterEntry[];
  };
  events: AuthEvent[];
};

const TOKEN_STORAGE_KEY = "v220_admin_redis_token";
const AUTO_OPEN_ITEM_LIMIT = 5;

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
}

function formatTtl(ttlSec: number) {
  if (ttlSec < 0) return "без TTL";
  if (ttlSec < 60) return `${ttlSec} сек`;
  const minutes = Math.floor(ttlSec / 60);
  const seconds = ttlSec % 60;
  if (minutes < 60) return `${minutes} мин ${seconds} сек`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось загрузить данные";
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function SpoilerSection({
  title,
  count,
  emptyMessage,
  children,
}: {
  title: string;
  count: number;
  emptyMessage: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(count <= AUTO_OPEN_ITEM_LIMIT);

  useEffect(() => {
    setOpen(count <= AUTO_OPEN_ITEM_LIMIT);
  }, [count]);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-2xl bg-card p-4 ring-1 ring-border"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-bold text-foreground [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <strong className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{count}</strong>
      </summary>

      {open && (
        <div className="mt-3">
          {count === 0 ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : children}
        </div>
      )}
    </details>
  );
}

function CounterList({ title, items }: { title: string; items: CounterEntry[] }) {
  return (
    <SpoilerSection title={title} count={items.length} emptyMessage="Нет данных">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
            <span className="min-w-0 truncate font-mono text-xs text-foreground">{item.key}</span>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{item.count}</span>
          </div>
        ))}
      </div>
    </SpoilerSection>
  );
}

function RateLimitList({ title, items }: { title: string; items: RateLimitEntry[] }) {
  return (
    <SpoilerSection title={title} count={items.length} emptyMessage="Нет активных ключей">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-lg bg-muted p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate font-mono text-xs text-foreground">{item.subject}</p>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                {item.count}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              TTL: {formatTtl(item.ttlSec)} · до {formatDate(item.expiresAt)}
            </p>
          </div>
        ))}
      </div>
    </SpoilerSection>
  );
}

function OtpList({ items }: { items: OtpEntry[] }) {
  return (
    <SpoilerSection title="Активные OTP" count={items.length} emptyMessage="Нет активных кодов">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-lg bg-muted p-3">
            <p className="font-semibold text-foreground">{item.emailMasked || item.emailHash}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Попытки: {item.tries} · TTL: {formatTtl(item.ttlSec)} · hash: {item.emailHash}
            </p>
          </div>
        ))}
      </div>
    </SpoilerSection>
  );
}

function CooldownList({ items }: { items: CooldownEntry[] }) {
  return (
    <SpoilerSection title="Cooldown отправки" count={items.length} emptyMessage="Нет активных cooldown">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-lg bg-muted p-3">
            <p className="font-semibold text-foreground">{item.emailMasked || item.emailHash}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              TTL: {formatTtl(item.ttlSec)} · до {formatDate(item.expiresAt)}
            </p>
          </div>
        ))}
      </div>
    </SpoilerSection>
  );
}

function SessionList({ items }: { items: SessionEntry[] }) {
  return (
    <SpoilerSection title="Сессии" count={items.length} emptyMessage="Нет активных сессий">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-lg bg-muted p-3">
            <p className="font-semibold text-foreground">{item.emailMasked || item.emailHash || "Без email"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              user: {item.userUuidPrefix || "—"} · TTL: {formatTtl(item.ttlSec)} · session exp:{" "}
              {formatDate(item.expAt)}
            </p>
          </div>
        ))}
      </div>
    </SpoilerSection>
  );
}

function EventList({ items }: { items: AuthEvent[] }) {
  return (
    <SpoilerSection title="Последние события" count={items.length} emptyMessage="Событий пока нет">
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item.id || `${item.at}-${index}`} className="rounded-lg bg-muted p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs font-bold text-foreground">{item.type || "event"}</p>
              <span className="text-xs text-muted-foreground">{formatDate(item.at)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              IP: {item.ip || "—"} · email: {item.emailMasked || item.emailHash || "—"} · status:{" "}
              {item.status || "—"}
            </p>
            {item.userAgent && <p className="mt-1 truncate text-xs text-muted-foreground">{item.userAgent}</p>}
          </div>
        ))}
      </div>
    </SpoilerSection>
  );
}

export default function AdminRedis() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) || "");
  const [snapshot, setSnapshot] = useState<RedisAuthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const didAutoLoad = useRef(false);

  const allRateLimitGroups = useMemo(() => {
    if (!snapshot) return [];
    return [
      { title: "Rate limit: отправка кода по IP", items: snapshot.rateLimits.sendCodeIp },
      { title: "Rate limit: отправка кода по email", items: snapshot.rateLimits.sendCodeEmail },
      { title: "Rate limit: проверка кода по IP", items: snapshot.rateLimits.verifyIp },
      { title: "Rate limit: checkout по session/IP", items: snapshot.rateLimits.checkoutSession },
    ];
  }, [snapshot]);

  const load = useCallback(async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("Введите ADMIN_REDIS_TOKEN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/admin/redis-auth`, {
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
      setSnapshot(body as RedisAuthSnapshot);
      localStorage.setItem(TOKEN_STORAGE_KEY, trimmedToken);
    } catch (err) {
      setError(asErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    if (token) void load();
  }, [load, token]);

  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2 text-primary">
                <Database className="h-5 w-5" />
                <span className="text-sm font-bold uppercase tracking-wide">Redis Auth Monitor</span>
              </div>
              <h1 className="text-2xl font-extrabold md:text-3xl">Данные авторизации из Redis</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                OTP, cooldown, сессии, rate-limit ключи, IP и последние попытки входа.
              </p>
            </div>
            <Button onClick={load} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить
            </Button>
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ADMIN_REDIS_TOKEN"
              className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button variant="outline" onClick={() => {
              localStorage.removeItem(TOKEN_STORAGE_KEY);
              setToken("");
              setSnapshot(null);
            }}>
              Сбросить токен
            </Button>
          </div>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" />
              {error}
            </div>
          )}
          {snapshot && (
            <p className="mt-3 text-xs text-muted-foreground">Обновлено: {formatDate(snapshot.generatedAt)}</p>
          )}
        </header>

        {snapshot && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="OTP" value={snapshot.totals.otp} />
              <StatCard label="Cooldown" value={snapshot.totals.cooldowns} />
              <StatCard label="Сессии" value={snapshot.totals.sessions} />
              <StatCard label="Rate limits" value={snapshot.totals.rateLimits} />
              <StatCard label="События" value={snapshot.totals.events} />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <CounterList title="Статистика по событиям" items={snapshot.stats.byType} />
              <CounterList title="Top IP" items={snapshot.stats.byIp} />
              <CounterList title="Top email hash" items={snapshot.stats.byEmailHash} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <OtpList items={snapshot.otp} />
              <CooldownList items={snapshot.cooldowns} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <SessionList items={snapshot.sessions} />
              <EventList items={snapshot.events} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {allRateLimitGroups.map((group) => (
                <RateLimitList key={group.title} title={group.title} items={group.items} />
              ))}
            </div>

            <div className="rounded-2xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-border">
              <Activity className="mr-2 inline h-4 w-4 text-primary" />
              Страница показывает только безопасный snapshot: OTP-коды и session/CSRF значения не выводятся.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
