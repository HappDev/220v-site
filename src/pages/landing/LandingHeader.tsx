import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import logo220v from "@/assets/logo-220v.webp";

type LandingHeaderProps = {
  /** Optional nav links/buttons rendered between logo and CTA. */
  nav?: ReactNode;
  /** Optional CTA on the right (defaults to "Войти" link to /). */
  cta?: ReactNode;
};

export const LandingHeader = ({ nav, cta }: LandingHeaderProps) => {
  const [open, setOpen] = useState(false);

  return (
    <header className="header">
      <div className="container header__inner">
        <Link to="/" className="logo" aria-label="220v">
          <img src={logo220v} alt="220v" className="logo__img" />
        </Link>

        <nav className={`nav${open ? " nav--open" : ""}`} aria-label="Главное меню">
          {nav}
        </nav>

        {cta ?? (
          <Link to="/" className="btn btn--ghost">
            Войти
          </Link>
        )}

        <button
          type="button"
          className="burger"
          aria-label="Меню"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
};

export default LandingHeader;
