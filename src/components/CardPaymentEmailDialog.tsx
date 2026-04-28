import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CardPaymentEmailDialogProps = {
  open: boolean;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function CardPaymentEmailDialog({
  open,
  loading = false,
  onOpenChange,
  onConfirm,
}: CardPaymentEmailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dash-modal sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Важная информация</DialogTitle>
          <DialogDescription>
            При оплате в системе Tribute, пожалуйста, <strong>указывайте тот же email</strong>. Иначе платёж может
            потеряться.
          </DialogDescription>
        </DialogHeader>

        <div className="dash-modal__stack">
          <button
            type="button"
            className="dash-modal-btn dash-modal-btn--primary"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Продолжить оплату"}
          </button>
          <button
            type="button"
            className="dash-modal-btn dash-modal-btn--ghost"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
