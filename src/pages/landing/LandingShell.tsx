import { useEffect, type ReactNode } from "react";
import "@/pages/landing.css";

type LandingShellProps = {
  children: ReactNode;
  /** Additional class on the outer wrapper (e.g. "landing-root--doc") */
  className?: string;
};

/** Shared wrapper for public-facing 220v pages — applies scoped landing styles. */
export const LandingShell = ({ children, className }: LandingShellProps) => {
  useEffect(() => {
    // Scoped landing-root handles background; ensure body has dark bg behind it for over-scroll.
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#0a0a0a";
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div className={`landing-root${className ? ` ${className}` : ""}`}>
      <div className="bg-glow" aria-hidden="true" />
      {children}
    </div>
  );
};

export default LandingShell;
