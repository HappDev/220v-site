import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  CreditCard,
  ShoppingCart,
  Gauge,
  BookOpen,
  LifeBuoy,
  MoreHorizontal,
  LogOut,
  Menu as MenuIcon,
  X as CloseIcon,
} from "lucide-react";
import logo220v from "@/assets/logo-220v.webp";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export type DashboardSidebarItem = {
  key: string;
  label: string;
  icon: IconType;
  onClick: () => void;
  primary?: boolean;
};

type DashboardSidebarProps = {
  items: DashboardSidebarItem[];
  onLogout: () => void;
  email?: string;
};

export const DashboardSidebar = ({ items, onLogout, email }: DashboardSidebarProps) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = prev;
    };
  }, [open]);

  const handleItem = (item: DashboardSidebarItem) => {
    setOpen(false);
    item.onClick();
  };

  return (
    <>
      <button
        type="button"
        className="dashboard-sidebar__burger"
        aria-label="Открыть меню"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      {open ? (
        <div
          className="dashboard-sidebar__backdrop"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={`dashboard-sidebar${open ? " dashboard-sidebar--open" : ""}`}
        aria-label="Главное меню"
      >
        <div className="dashboard-sidebar__head">
          <Link to="/" className="dashboard-sidebar__logo" aria-label="220v">
            <img src={logo220v} alt="220v" className="dashboard-sidebar__logo-img" />
          </Link>
          <button
            type="button"
            className="dashboard-sidebar__close"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {email ? <div className="dashboard-sidebar__email">{email}</div> : null}

        <nav className="dashboard-sidebar__nav">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`dashboard-sidebar__link${
                  item.primary ? " dashboard-sidebar__link--primary" : ""
                }`}
                onClick={() => handleItem(item)}
              >
                <Icon className="h-5 w-5 dashboard-sidebar__link-icon" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="dashboard-sidebar__foot">
          <button
            type="button"
            className="dashboard-sidebar__link dashboard-sidebar__link--logout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut className="h-5 w-5 dashboard-sidebar__link-icon" />
            <span>Выйти</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default DashboardSidebar;
