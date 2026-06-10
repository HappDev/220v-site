import type { FormEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Database, GitBranch, KeyRound, Loader2, LogOut, ShieldAlert, UserRoundCog } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ADMIN_TOKEN_STORAGE_KEY } from "@/lib/admin";
import { cn } from "@/lib/utils";

type AdminPageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  token: string;
  onTokenChange: (value: string) => void;
  onReset: () => void;
  onRefresh: () => void;
  loading: boolean;
  error: string;
  updatedAt?: string | null;
  children: ReactNode;
};

const ADMIN_LINKS = [
  { href: "/admin/redis", label: "Авторизации", Icon: Database },
  { href: "/admin/referrals", label: "Рефералы", Icon: GitBranch },
];

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU");
}

export default function AdminPageShell({
  eyebrow,
  title,
  description,
  icon: Icon,
  token,
  onTokenChange,
  onReset,
  onRefresh,
  loading,
  error,
  updatedAt,
  children,
}: AdminPageShellProps) {
  const location = useLocation();

  const handleReset = () => {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    onTokenChange("");
    onReset();
  };

  const handleAuthorize = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRefresh();
  };

  return (
    <div className="min-h-[100svh] min-h-[100dvh] bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <nav className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-card p-2 shadow-sm ring-1 ring-border">
          <div className="flex flex-wrap gap-2">
            {ADMIN_LINKS.map(({ href, label, Icon: LinkIcon }) => {
              const active = location.pathname === href;
              return (
                <Link
                  key={href}
                  to={href}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <LinkIcon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <UserRoundCog className="h-4 w-4" />
                Доступ
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <p className="mb-3 text-sm font-semibold">Админ-доступ</p>
              <form className="space-y-3" onSubmit={handleAuthorize}>
                <input
                  type="password"
                  value={token}
                  onChange={(event) => onTokenChange(event.target.value)}
                  placeholder="ADMIN_REDIS_TOKEN"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring md:text-sm"
                />
                <Button type="submit" disabled={loading} className="w-full gap-2">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Авторизоваться
                </Button>
              </form>
              <div className="my-3 h-px bg-muted" />
              <Button type="button" variant="outline" onClick={handleReset} className="w-full gap-2">
                <LogOut className="h-4 w-4" />
                Выход
              </Button>
            </PopoverContent>
          </Popover>
        </nav>

        <header className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2 text-primary">
                <Icon className="h-5 w-5" />
                <span className="text-sm font-bold uppercase">{eyebrow}</span>
              </div>
              <h1 className="text-2xl font-extrabold md:text-3xl">{title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" />
              {error}
            </div>
          )}
          {updatedAt && <p className="mt-3 text-xs text-muted-foreground">Обновлено: {formatDate(updatedAt)}</p>}
        </header>

        {children}
      </div>
    </div>
  );
}
