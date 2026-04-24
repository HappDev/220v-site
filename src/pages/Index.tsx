import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { invokeFunction } from "@/lib/api";
import { consumeVpnPendingRedirect, getVpnAuthEmail, persistVpnAuth } from "@/lib/vpnStorage";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

import LandingShell from "@/pages/landing/LandingShell";
import LandingHeader from "@/pages/landing/LandingHeader";
import LandingFooter from "@/pages/landing/LandingFooter";
import LandingModal from "@/pages/landing/LandingModal";
import mascot220v from "@/assets/mascot-220v.png";

/** Совпадает с ключом в Dashboard: отложенный query после входа с deep link */
const DASHBOARD_PENDING_SEARCH_KEY = "vpn_dashboard_pending_search";

const ALLOWED_DASHBOARD_DEEP_KEYS = new Set([
  "devices",
  "subscription",
  "buy",
  "instructions",
  "referral",
  "promo",
  "about",
]);

function hrefAfterLoginFromPendingSearch(): string {
  // 1) Универсальный pending redirect (сохраняется RequireVpnAuth при попытке
  //    открыть защищённую страницу без авторизации).
  const pending = consumeVpnPendingRedirect();
  if (pending) return pending;

  // 2) Легаси: deep link на dashboard с query-параметрами.
  try {
    const search = sessionStorage.getItem(DASHBOARD_PENDING_SEARCH_KEY);
    sessionStorage.removeItem(DASHBOARD_PENDING_SEARCH_KEY);
    if (!search || search.length > 512 || !search.startsWith("?")) {
      return "/dashboard";
    }
    const sp = new URLSearchParams(search.slice(1));
    const keys = [...sp.keys()];
    if (keys.length === 0) {
      return "/dashboard";
    }
    for (const key of keys) {
      if (!ALLOWED_DASHBOARD_DEEP_KEYS.has(key)) {
        return "/dashboard";
      }
    }
    return `/dashboard${search}`;
  } catch {
    return "/dashboard";
  }
}

type LoginStep = "email" | "verify";

const Index = () => {
  const [email, setEmail] = useState("");
  const [hash, setHash] = useState("");
  const [code, setCode] = useState("");
  const [loginStep, setLoginStep] = useState<LoginStep>("email");
  const [loginOpen, setLoginOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const normalizedEmail = email.trim().toLowerCase();

  useEffect(() => {
    if (getVpnAuthEmail()) {
      navigate(hrefAfterLoginFromPendingSearch(), { replace: true });
      return;
    }
    setSessionReady(true);
  }, [navigate]);

  const openLogin = () => {
    setLoginStep("email");
    setCode("");
    setHash("");
    setLoginOpen(true);
  };

  const closeLogin = () => {
    if (loading) return;
    setLoginOpen(false);
  };

  const handleStart = async () => {
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast({ title: "Ошибка", description: "Укажите корректный email", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await invokeFunction("send-code", {
        email: normalizedEmail,
      });

      if (error) throw error;

      if (data?.hash) {
        setHash(data.hash);
        setLoginStep("verify");
        toast({
          title: "✅ Код отправлен!",
          description: `Код подтверждения отправлен на ${normalizedEmail}`,
          className: "bg-green-500 text-white border-green-600",
        });
      } else {
        toast({ title: "Ошибка", description: data?.error || "Не удалось отправить код", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Ошибка отправки", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!code || code.length < 4) {
      toast({ title: "Ошибка", description: "Введите код подтверждения", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await invokeFunction("send-code", {
        email: normalizedEmail,
        hash,
        code,
        action: "verify",
      });

      if (error) throw error;

      if (data?.verified) {
        persistVpnAuth(normalizedEmail, hash, code);
        navigate(hrefAfterLoginFromPendingSearch());
      } else {
        toast({ title: "Ошибка", description: data?.error || "Неверный код", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Ошибка проверки кода", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-label="Загрузка" />
      </div>
    );
  }

  return (
    <LandingShell>
      <LandingHeader
        nav={
          <>
            <button type="button" className="nav__link" onClick={() => setAboutOpen(true)}>
              О нас
            </button>
            <button type="button" className="nav__link" onClick={() => setPricingOpen(true)}>
              Цены
            </button>
          </>
        }
        cta={
          <button type="button" className="btn btn--ghost" onClick={openLogin}>
            Войти
          </button>
        }
      />

      <main>
        <section className="hero">
          <div className="container hero__grid">
            <div className="hero__content">
              <h1 className="hero__title">
                Оставайтесь{" "}
                <br />
                <span className="accent">невидимыми</span>{" "}
                <br />
                для посторонних{" "}
                <br />
                с <span className="accent">220v</span>
              </h1>
              <p className="hero__desc">
                Мы надёжно скрываем ваши данные{" "}
                <br />
                и шифруем каждое действие в сети.{" "}
                <br />
                Один сервис для безопасности{" "}
                <br />
                всех ваших гаджетов.
              </p>
              <button type="button" className="btn btn--primary btn--lg" onClick={openLogin}>
                <svg viewBox="0 0 24 24" className="btn__icon" aria-hidden="true">
                  <path d="M13 2 L4 14 h7 l-2 8 l9-12 h-7 l2-8 Z" fill="currentColor" />
                </svg>
                Регистрация в 220v
              </button>
            </div>

            <div className="hero__visual">
              <div className="hero__mascot-glow" aria-hidden="true" />
              <img src={mascot220v} alt="Маскот 220v" className="hero__mascot" />
            </div>
          </div>

          <div className="container">
            <ul className="features" role="list">
              <li className="feature">
                <span className="feature__icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path
                      d="M16 3 4 7v9c0 7 5 12 12 13 7-1 12-6 12-13V7l-12-4Z"
                      stroke="#C6FF3D"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="m11 16 4 4 7-8"
                      stroke="#C6FF3D"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h3 className="feature__title">Безопасно</h3>
                <p className="feature__desc">
                  Ваши данные{" "}
                  <br />
                  под защитой
                </p>
              </li>
              <li className="feature">
                <span className="feature__icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path d="M18 3 6 18h7l-3 11 12-15h-7l3-11Z" stroke="#C6FF3D" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </span>
                <h3 className="feature__title">Быстро</h3>
                <p className="feature__desc">
                  Высокая скорость{" "}
                  <br />
                  без ограничений
                </p>
              </li>
              <li className="feature">
                <span className="feature__icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <circle cx="16" cy="16" r="13" stroke="#C6FF3D" strokeWidth="2" />
                    <path
                      d="M3 16h26M16 3c3.5 4 5.5 8 5.5 13s-2 9-5.5 13c-3.5-4-5.5-8-5.5-13S12.5 7 16 3Z"
                      stroke="#C6FF3D"
                      strokeWidth="2"
                    />
                  </svg>
                </span>
                <h3 className="feature__title">Свободно</h3>
                <p className="feature__desc">
                  Доступ к любому{" "}
                  <br />
                  контенту
                </p>
              </li>
              <li className="feature">
                <span className="feature__icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path
                      d="M12 3v7M20 3v7M8 10h16v6a8 8 0 0 1-8 8 8 8 0 0 1-8-8v-6ZM16 24v5"
                      stroke="#C6FF3D"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h3 className="feature__title">Всегда на связи</h3>
                <p className="feature__desc">
                  220v — энергия{" "}
                  <br />
                  свободы в интернете
                </p>
              </li>
            </ul>
          </div>
        </section>
      </main>

      <LandingFooter />

      {/* About modal */}
      <LandingModal open={aboutOpen} onClose={() => setAboutOpen(false)} title="О нас">
        <p>
          Опираясь на многолетний опыт управления серверами, наша команда разработала сервис для создания защищённых
          интернет-туннелей.
        </p>
        <p>
          Мы понимаем все тонкости маршрутизации и выстраивания анонимных соединений. Наш приоритет — чтобы трафик
          клиентов всегда шёл к нужным ресурсам по оптимальным и безопасным путям.
        </p>
        <p>
          Мы лично пользуемся своей разработкой каждый день, на 100% уверены в её качестве и с гордостью предлагаем её
          вам!
        </p>
      </LandingModal>

      {/* Pricing modal */}
      <LandingModal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        title="Тарифы"
        subtitle="Выберите срок — чем дольше, тем выгоднее"
        wide
      >
        <div className="plans">
          <div className="plan">
            <div className="plan__head">
              <h3 className="plan__name">1 месяц</h3>
            </div>
            <div className="plan__price">
              <span className="plan__amount">450</span>
              <span className="plan__currency">₽</span>
            </div>
            <p className="plan__period">за 1 месяц</p>
            <ul className="plan__features" role="list">
              <li>Все локации</li>
              <li>Безлимитный трафик*</li>
              <li>Поддержка 24/7</li>
            </ul>
            <a href="https://t.me/vpn220v_bot" className="btn btn--ghost btn--wide plan__btn">
              Выбрать
            </a>
          </div>

          <div className="plan plan--featured">
            <span className="plan__badge">-15%</span>
            <div className="plan__head">
              <h3 className="plan__name">6 месяцев</h3>
            </div>
            <div className="plan__price">
              <span className="plan__amount">2 295</span>
              <span className="plan__currency">₽</span>
            </div>
            <p className="plan__period">≈ 382 ₽ / месяц</p>
            <ul className="plan__features" role="list">
              <li>Все локации</li>
              <li>Безлимитный трафик*</li>
              <li>Поддержка 24/7</li>
              <li>Экономия 15%</li>
            </ul>
            <a href="https://t.me/vpn220v_bot" className="btn btn--primary btn--wide plan__btn">
              Выбрать
            </a>
          </div>

          <div className="plan">
            <span className="plan__badge plan__badge--alt">-30%</span>
            <div className="plan__head">
              <h3 className="plan__name">1 год</h3>
            </div>
            <div className="plan__price">
              <span className="plan__amount">3 780</span>
              <span className="plan__currency">₽</span>
            </div>
            <p className="plan__period">≈ 315 ₽ / месяц</p>
            <ul className="plan__features" role="list">
              <li>Все локации</li>
              <li>Безлимитный трафик*</li>
              <li>Приоритетная поддержка</li>
              <li>Максимальная выгода — 30%</li>
            </ul>
            <a href="https://t.me/vpn220v_bot" className="btn btn--ghost btn--wide plan__btn">
              Выбрать
            </a>
          </div>
        </div>

        <p className="modal__note">
          * На серверах категории «Мобильная сеть» действует лимит 10 ГБ в месяц. Подробнее — в{" "}
          <a href="/terms" className="modal__link">
            условиях использования
          </a>
          .
        </p>
      </LandingModal>

      {/* Login modal */}
      <LandingModal
        open={loginOpen}
        onClose={closeLogin}
        title={loginStep === "email" ? "Вход в 220v" : "Введите код"}
        subtitle={
          loginStep === "email"
            ? "Мы отправим код подтверждения на вашу почту"
            : `Код отправлен на ${normalizedEmail}`
        }
      >
        {loginStep === "email" ? (
          <div className="login-card" style={{ background: "transparent", border: 0, padding: 0, boxShadow: "none" }}>
            <div className="form-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleStart();
                }}
                disabled={loading}
              />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary btn--wide"
                onClick={handleStart}
                disabled={loading}
              >
                {loading ? "Отправка..." : "Отправить код"}
              </button>
            </div>
          </div>
        ) : (
          <div className="login-card" style={{ background: "transparent", border: 0, padding: 0, boxShadow: "none" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} className="h-12 w-12 text-lg font-bold bg-white text-black" />
                  <InputOTPSlot index={1} className="h-12 w-12 text-lg font-bold bg-white text-black" />
                  <InputOTPSlot index={2} className="h-12 w-12 text-lg font-bold bg-white text-black" />
                  <InputOTPSlot index={3} className="h-12 w-12 text-lg font-bold bg-white text-black" />
                  <InputOTPSlot index={4} className="h-12 w-12 text-lg font-bold bg-white text-black" />
                  <InputOTPSlot index={5} className="h-12 w-12 text-lg font-bold bg-white text-black" />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary btn--wide"
                onClick={handleVerify}
                disabled={loading || code.length < 6}
              >
                {loading ? "Проверка..." : "Подтвердить"}
              </button>
            </div>
            <p className="form-link">
              <button type="button" onClick={() => setLoginStep("email")} disabled={loading}>
                ← Изменить email
              </button>
            </p>
          </div>
        )}
      </LandingModal>
    </LandingShell>
  );
};

export default Index;
