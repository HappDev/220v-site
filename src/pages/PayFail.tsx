import { useNavigate } from "react-router-dom";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const PayFail = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-lg ring-1 ring-border">
        <XCircle className="mx-auto mb-4 h-14 w-14 text-destructive" aria-hidden />
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Оплата не завершена</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Платёж отменён или не прошёл. Вы можете попробовать снова в личном кабинете.
        </p>
        <Button className="w-full rounded-lg" onClick={() => navigate("/dashboard", { replace: true })}>
          В личный кабинет
        </Button>
      </div>
    </div>
  );
};

export default PayFail;
