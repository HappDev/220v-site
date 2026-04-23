import { Link } from "react-router-dom";
import logo220v from "@/assets/logo-220v.webp";

export const LandingFooter = () => (
  <footer className="footer">
    <div className="container footer__inner">
      <Link to="/" className="logo logo--footer" aria-label="220v">
        <img src={logo220v} alt="220v" className="logo__img" />
      </Link>
      <nav className="footer__links" aria-label="Правовая информация">
        <Link to="/terms" className="footer__link">
          Условия использования
        </Link>
        <span className="footer__dot" aria-hidden="true">
          •
        </span>
        <Link to="/policy" className="footer__link">
          Политика конфиденциальности
        </Link>
      </nav>
      <p className="footer__copy">© 2026 220v. Все права защищены.</p>
    </div>
  </footer>
);

export default LandingFooter;
