import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { invokeFunction } from "@/lib/api";
import DashboardSidebar from "@/components/DashboardSidebar";
import { useDashboardSidebarItems } from "@/hooks/useDashboardSidebarItems";
import LandingShell from "@/pages/landing/LandingShell";
import LandingFooter from "@/pages/landing/LandingFooter";

type BillingMeta = {
  products?: {
    product_key: string;
    price: number | null;
  }[];
};

type TrafficOption = {
  gb: number;
  productKey: string;
  label: string;
  fallbackPrice: number;
};

const TRAFFIC_OPTIONS: TrafficOption[] = [
  { gb: 20, productKey: "traffic_20gb", label: "20 ГБ", fallbackPrice: 150 },
  { gb: 50, productKey: "traffic_50gb", label: "50 ГБ", fallbackPrice: 300 },
];

const formatRub = (value: number) => value.toLocaleString("ru-RU");

const Traffic = () => {
  const navigate = useNavigate();
  const { email, items, handleLogout } = useDashboardSidebarItems();
  const [priceByKey, setPriceByKey] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await invokeFunction<BillingMeta>("billing/meta", {});
      if (cancelled) return;
      const next: Record<string, number> = {};
      if (data?.products) {
        for (const p of data.products) {
          if (p?.product_key && typeof p.price === "number") {
            next[p.product_key] = p.price;
          }
        }
      }
      setPriceByKey(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(() => {
    return TRAFFIC_OPTIONS.map((opt) => {
      const price = priceByKey[opt.productKey] ?? opt.fallbackPrice;
      const perGb = opt.gb > 0 ? Math.round(price / opt.gb) : price;
      return { ...opt, price, perGb };
    });
  }, [priceByKey]);

  return (
    <LandingShell className="landing-root--with-sidebar">
      <DashboardSidebar items={items} onLogout={handleLogout} email={email || undefined} />

      <main>
        <section className="price-page">
          <div className="container">
            <div className="price-page__head">
              <h1 className="price-page__title">Купить трафик</h1>
              <p className="price-page__subtitle">
                Дополнительные пакеты трафика для LTE-серверов
              </p>
            </div>

            <div className="plans plans--page">
              {cards.map((c) => (
                <div key={c.gb} className="plan">
                  <div className="plan__block">
                    <span className="plan__eyebrow">Пакет</span>
                    <div className="plan__head">
                      <h3 className="plan__name">{c.label}</h3>
                    </div>
                  </div>

                  <div className="plan__block">
                    <span className="plan__eyebrow">Цена</span>
                    <div className="plan__price">
                      <span className="plan__amount">{formatRub(c.price)}</span>
                      <span className="plan__currency">₽</span>
                    </div>
                    <p className="plan__period">≈ {formatRub(c.perGb)} ₽ / ГБ</p>
                  </div>

                  <button
                    type="button"
                    className="btn btn--ghost btn--wide plan__btn"
                    disabled={loading}
                    onClick={() => navigate(`/traffic/pay?gb=${c.gb}`)}
                  >
                    Выбрать
                  </button>
                </div>
              ))}
            </div>

            <p className="price-page__note">
              Трафик тарифицируется только на LTE-серверах. На остальных локациях он безлимитный. Подробнее — в{" "}
              <Link to="/terms" className="modal__link">
                условиях использования
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      <LandingFooter />
    </LandingShell>
  );
};

export default Traffic;
