import { Link } from "react-router-dom";

import LandingShell from "@/pages/landing/LandingShell";
import LandingHeader from "@/pages/landing/LandingHeader";
import LandingFooter from "@/pages/landing/LandingFooter";

const Price = () => (
  <LandingShell>
    <LandingHeader
      nav={
        <Link to="/" className="nav__link">
          Главная
        </Link>
      }
      cta={
        <Link to="/" className="btn btn--ghost">
          На главную
        </Link>
      }
    />

    <main>
      <section className="price-page">
        <div className="container">
          <div className="price-page__head">
            <h1 className="price-page__title">Тарифы</h1>
            <p className="price-page__subtitle">Выберите срок — чем дольше, тем выгоднее</p>
          </div>

          <div className="plans plans--page">
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

          <p className="price-page__note">
            * На серверах категории «Мобильная сеть» действует лимит 10 ГБ в месяц. Подробнее — в{" "}
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

export default Price;
