import { useNavigate } from "react-router-dom";
import { CheckCircle2, BookOpen } from "lucide-react";

const PaySuccess = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-lg ring-1 ring-border">
        <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-green-600 dark:text-green-500" aria-hidden />
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Оплата прошла успешно</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Спасибо! Можете открыть личный кабинет или настроить подключение по инструкции.
        </p>
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => navigate("/dashboard", { replace: true })}
            className="flex-1 rounded-lg bg-secondary py-3 text-center text-sm font-semibold text-secondary-foreground transition-opacity hover:opacity-90"
          >
            В личный кабинет
          </button>
          <button
            type="button"
            onClick={() =>
              navigate("/dashboard", { replace: true, state: { openInstructions: true } })
            }
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-3 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <BookOpen className="h-4 w-4" />
            Инструкции
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaySuccess;
