import { useNavigate } from "react-router-dom";
import { BookOpen, CheckCircle2 } from "lucide-react";

import successMascot from "@/assets/pay-success-mascot.png";
import LandingFooter from "@/pages/landing/LandingFooter";
import LandingHeader from "@/pages/landing/LandingHeader";
import LandingShell from "@/pages/landing/LandingShell";

const PaySuccess = () => {
  const navigate = useNavigate();

  return (
    <LandingShell>
      <LandingHeader
        nav={
          <button type="button" className="nav__link" onClick={() => navigate("/")}>
            Главная
          </button>
        }
        cta={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/dashboard", { replace: true })}
          >
            Личный кабинет
          </button>
        }
      />

      <main>
        <section className="pay-success">
          <div className="container pay-success__container">
            <article className="pay-success__card" aria-labelledby="pay-success-title">
              <div className="pay-success__mascot-wrap">
                <div className="pay-success__mascot-glow" aria-hidden="true" />
                <img src={successMascot} alt="Маскот 220v" className="pay-success__mascot" />
              </div>

              <div className="pay-success__badge">
                <CheckCircle2 aria-hidden="true" />
                Оплата подтверждена
              </div>

              <h1 id="pay-success-title">Оплата прошла успешно</h1>
              <p>Спасибо! Можете открыть личный кабинет или сразу перейти к инструкции по подключению.</p>

              <div className="pay-success__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  onClick={() => navigate("/dashboard", { replace: true })}
                >
                  В личный кабинет
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--lg"
                  onClick={() => navigate("/instructions", { replace: true })}
                >
                  <BookOpen className="btn__icon" aria-hidden="true" />
                  Инструкции
                </button>
              </div>
            </article>
          </div>
        </section>
      </main>

      <LandingFooter />
    </LandingShell>
  );
};

export default PaySuccess;
