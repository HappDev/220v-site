import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiBase } from "@/lib/api";
import { getVpnAuthEmail } from "@/lib/vpnStorage";
import LandingShell from "@/pages/landing/LandingShell";
import LandingHeader from "@/pages/landing/LandingHeader";
import LandingFooter from "@/pages/landing/LandingFooter";

const Support = () => {
  const navigate = useNavigate();
  const email = getVpnAuthEmail();
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetch(`${apiBase}/announcement`)
      .then((r) => r.json() as Promise<{ text?: unknown }>)
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.text === "string" && data.text.trim()) setAnnouncement(data.text.trim());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [email]);

  return (
    <LandingShell>
      <LandingHeader
        nav={
          <>
            <Link to="/" className="nav__link">
              Главная
            </Link>
            <button type="button" className="nav__link" onClick={() => navigate("/dashboard")}>
              Кабинет
            </button>
          </>
        }
        cta={
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/dashboard")}>
            В кабинет
          </button>
        }
      />

      <main>
        <section className="app-page">
          <div className="container">
            <div className="app-page__eyebrow">Поддержка 220v</div>
            <h1 className="app-page__title">Поможем подключиться, настроить и решить вопросы по сервису.</h1>
            <p className="app-page__subtitle">
              Пишите нам в чат или на почту — команда поддержки отвечает каждый день и помогает быстро вернуть доступ к
              сервису.
            </p>

            <div className="support-layout">
              <div className="support-grid">
                <section className="support-card">
                  <h2 className="support-card__title">Связаться с нами</h2>
                  <p className="support-card__subtitle">
                    Выберите удобный способ связи. Мы подскажем по оплате, подключению устройств и работе приложения.
                  </p>

                  <div className="support-meta">
                    <div className="support-meta__item">
                      <span className="support-meta__label">Email</span>
                      <a href="mailto:support@220v.shop" className="support-meta__value support-meta__link">
                        support@220v.shop
                      </a>
                    </div>
                    <div className="support-meta__item">
                      <span className="support-meta__label">Время работы</span>
                      <span className="support-meta__value">с 05:00 до 01:00 ежедневно по МСК</span>
                    </div>
                    <div className="support-meta__item">
                      <span className="support-meta__label">Личный кабинет</span>
                      <button type="button" className="support-meta__value support-meta__link text-left" onClick={() => navigate("/dashboard")}>
                        Вернуться в личный кабинет
                      </button>
                    </div>
                  </div>
                </section>

                <section className="support-card support-chat">
                  <h2 className="support-card__title">Чат с поддержкой</h2>
                  <p className="support-card__subtitle">Онлайн-чат 220v (Talk-Me) доступен прямо на этой странице.</p>

                  <div className="support-chat__frame">
                    <div id="TalkMe-container" style={{ height: 400, width: "100%" }} />
                  </div>
                </section>
              </div>

              {announcement ? (
                <section className="support-card support-announcement" role="status" aria-label="Важное объявление">
                  <h2 className="support-card__title">Важное объявление</h2>
                  <p className="support-card__subtitle whitespace-pre-wrap">{announcement}</p>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </LandingShell>
  );
};

export default Support;
