import { useEffect, type ReactNode } from "react";

type LandingModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
};

export const LandingModal = ({ open, onClose, title, subtitle, wide, children }: LandingModalProps) => {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={onClose} />
      <div className={`modal__dialog${wide ? " modal__dialog--wide" : ""}`} role="document">
        <button type="button" className="modal__close" aria-label="Закрыть" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h2 className="modal__title">{title}</h2>
        {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
};

export default LandingModal;
