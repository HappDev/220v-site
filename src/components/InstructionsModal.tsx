import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Smartphone,
  Apple,
  Monitor,
  Terminal,
  Tv,
  Copy,
  QrCode,
  Image,
  Video,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import ios1 from "@/assets/screenshots/ios1.png";
import ios2 from "@/assets/screenshots/ios2.png";
import and1 from "@/assets/screenshots/and1.jpg";
import and2 from "@/assets/screenshots/and2.jpg";
import and3 from "@/assets/screenshots/and3.jpg";
import win1 from "@/assets/screenshots/win1.png";
import win2 from "@/assets/screenshots/win2.png";
import lin1 from "@/assets/screenshots/lin1.png";
import lin2 from "@/assets/screenshots/lin2.png";
import atv1 from "@/assets/screenshots/atv1.webp";
import atv2 from "@/assets/screenshots/atv2.webp";
import tv1 from "@/assets/screenshots/tv1.png";
import tv2 from "@/assets/screenshots/tv2.png";

export type InstructionsPlatform = "android" | "ios" | "windows" | "linux" | "appletv" | "androidtv";

interface InstructionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionUrl?: string;
  /** Якорная ссылка: конкретная платформа; без пропа — авто по User-Agent */
  initialPlatform?: InstructionsPlatform;
}

type Platform = InstructionsPlatform;

type InstructionsClient = { layout: "dropdown" | "grid"; defaultPlatform: Platform };

/** Android / iOS(iPhone,iPad) / macOS — выпадающий список; ПК (Windows, Linux, …) — сетка. */
function detectInstructionsClient(): InstructionsClient {
  if (typeof navigator === "undefined") {
    return { layout: "grid", defaultPlatform: "windows" };
  }
  const ua = navigator.userAgent;
  const navPlatform = navigator.platform || "";
  const maxTouch = navigator.maxTouchPoints ?? 0;

  const isIPad = /iPad/.test(ua) || (navPlatform === "MacIntel" && maxTouch > 1);
  const isIOS = /iPhone|iPod/.test(ua) || isIPad;
  const isAndroid = /Android/i.test(ua);
  const isMacOS =
    !isIOS &&
    !isAndroid &&
    (/Mac OS X|Macintosh/i.test(ua) || (navPlatform === "MacIntel" && maxTouch === 0));

  if (isAndroid) return { layout: "dropdown", defaultPlatform: "android" };
  if (isIOS) return { layout: "dropdown", defaultPlatform: "ios" };
  if (isMacOS) return { layout: "dropdown", defaultPlatform: "ios" };

  const isLinux = /Linux/i.test(ua) && !isAndroid;
  if (isLinux) return { layout: "grid", defaultPlatform: "linux" };

  const isWindows = /Win/i.test(navPlatform) || /Windows/i.test(ua);
  if (isWindows) return { layout: "grid", defaultPlatform: "windows" };

  return { layout: "grid", defaultPlatform: "windows" };
}

const platforms: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: "android", label: "Android", icon: <Smartphone className="h-5 w-5" /> },
  { id: "ios", label: "iOS / macOS", icon: <Apple className="h-5 w-5" /> },
  { id: "windows", label: "Windows", icon: <Monitor className="h-5 w-5" /> },
  { id: "linux", label: "Linux", icon: <Terminal className="h-5 w-5" /> },
  { id: "appletv", label: "Apple TV", icon: <Tv className="h-5 w-5" /> },
  { id: "androidtv", label: "Android TV", icon: <Tv className="h-5 w-5" /> },
];

const screenshotsByPlatform: Partial<Record<Platform, string[]>> = {
  ios: [ios1, ios2],
  android: [and1, and2, and3],
  windows: [win1, win2],
  linux: [lin1, lin2],
  appletv: [atv1, atv2],
  androidtv: [tv1, tv2],
};

const CopySubscriptionLink = ({ subscriptionUrl }: { subscriptionUrl?: string }) => {
  const btnRef = React.useRef<HTMLButtonElement>(null);

  const handleCopy = () => {
    if (!subscriptionUrl) {
      toast.error("Ссылка подписки недоступна");
      return;
    }

    const container = btnRef.current;
    if (!container) return;

    const input = document.createElement("input");
    input.type = "text";
    input.value = subscriptionUrl;
    input.style.position = "absolute";
    input.style.opacity = "0";
    input.style.height = "0";
    input.style.fontSize = "16px";
    container.appendChild(input);
    input.focus();
    input.setSelectionRange(0, input.value.length);

    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    container.removeChild(input);

    if (ok) {
      toast.success("Ссылка скопирована!", {
        style: { background: "#22c55e", color: "#fff", border: "none" },
      });
    } else {
      toast.error("Не удалось скопировать. Скопируйте вручную:", {
        description: subscriptionUrl,
        duration: 8000,
      });
    }
  };

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={handleCopy}
      className="relative inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
    >
      <Copy className="h-3.5 w-3.5" />
      Скопировать ссылку подписки
    </button>
  );
};

const QrCodeLink = ({
  subscriptionUrl,
  onOpenQr,
}: {
  subscriptionUrl?: string;
  onOpenQr: () => void;
}) => {
  const handleOpen = () => {
    if (!subscriptionUrl) {
      toast.error("Ссылка подписки недоступна");
      return;
    }
    onOpenQr();
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
    >
      <QrCode className="h-3.5 w-3.5" />
      QR-Code
    </button>
  );
};

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold text-primary hover:underline"
  >
    {children}
  </a>
);

const ActionButtons = ({
  onScreenshots,
}: {
  onScreenshots: () => void;
}) => (
  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
    <Button variant="outline" className="flex-1 gap-2" onClick={onScreenshots}>
      <Image className="h-4 w-4" />
      Скриншоты
    </Button>
    <Button
      variant="outline"
      className="flex-1 gap-2"
      onClick={() => toast.info("Видеоинструкция в данный момент недоступна")}
    >
      <Video className="h-4 w-4" />
      Видеоинструкция
    </Button>
  </div>
);

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <div className="flex items-center gap-3">
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
      {n}
    </span>
    <div className="min-w-0 flex-1 text-sm text-foreground">{children}</div>
  </div>
);

export function oneClickHappUrl(subscriptionUrl: string) {
  return `happ://add/${encodeURIComponent(subscriptionUrl)}`;
}

const OneClickAddButton = ({ subscriptionUrl }: { subscriptionUrl?: string }) => (
  <Button
    type="button"
    variant="default"
    className="mt-2 block w-full sm:w-auto"
    disabled={!subscriptionUrl}
    onClick={() => {
      if (!subscriptionUrl) {
        toast.error("Ссылка подписки недоступна");
        return;
      }
      window.location.href = oneClickHappUrl(subscriptionUrl);
    }}
  >
    Добавить в один клик
  </Button>
);

const ScreenshotGallery = ({
  images,
  open,
  onOpenChange,
  large,
}: {
  images: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  large?: boolean;
}) => {
  const [idx, setIdx] = useState(0);
  const prev = () => setIdx((i) => (i > 0 ? i - 1 : images.length - 1));
  const next = () => setIdx((i) => (i < images.length - 1 ? i + 1 : 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[90vh] overflow-hidden ${large ? "sm:max-w-4xl" : "sm:max-w-lg"}`}>
        <DialogHeader>
          <DialogTitle>Скриншоты</DialogTitle>
          <DialogDescription>
            {idx + 1} / {images.length}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={prev} className="shrink-0 rounded-full p-1 hover:bg-accent">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <img
            src={images[idx]}
            alt={`Скриншот ${idx + 1}`}
            className={`min-w-0 rounded-lg object-contain ${large ? "max-h-[80vh] w-full" : "max-h-[65vh] w-full"}`}
          />
          <button onClick={next} className="shrink-0 rounded-full p-1 hover:bg-accent">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const InstructionsModal = ({ open, onOpenChange, subscriptionUrl, initialPlatform }: InstructionsModalProps) => {
  const client = useMemo(() => detectInstructionsClient(), []);
  const [platform, setPlatform] = useState<Platform>(client.defaultPlatform);
  const [screenshotsOpen, setScreenshotsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialPlatform) {
      setPlatform(initialPlatform);
    } else {
      setPlatform(client.defaultPlatform);
    }
  }, [open, initialPlatform, client.defaultPlatform]);

  const handleScreenshots = () => {
    const shots = screenshotsByPlatform[platform];
    if (shots && shots.length > 0) {
      setScreenshotsOpen(true);
    }
  };

  const desktopContent: Record<Platform, React.ReactNode> = {
    android: (
      <div className="flex flex-col gap-3">
        <Step n={1}>
          <strong>Установка:</strong>{" "}
          <ExternalLink href="https://play.google.com/store/apps/details?id=com.happproxy">Google Play</ExternalLink>{" "}
          или{" "}
          <ExternalLink href="https://disk.yandex.ru/d/u_d6cVaTVnyWuw">Скачай APK</ExternalLink>.
        </Step>
        <Step n={2}>
          <strong>Копирование:</strong> Нажми <CopySubscriptionLink subscriptionUrl={subscriptionUrl} /> или отсканируй{" "}
          <QrCodeLink subscriptionUrl={subscriptionUrl} onOpenQr={() => setQrOpen(true)} />.
        </Step>
        <Step n={3}>
          <strong>Импорт:</strong> Открой Happ. На главном экране внизу слева нажми кнопку «Из буфера». Или отсканируй
          QR-Code.
        </Step>
        <Step n={4}>
          <strong>Запуск:</strong> Выбери сервер и нажми кнопку подключения.
        </Step>
        <ActionButtons onScreenshots={handleScreenshots} />
      </div>
    ),
    ios: (
      <div className="flex flex-col gap-3">
        <Step n={1}>
          <strong>Установка:</strong> Установи{" "}
          <ExternalLink href="https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973">Happ</ExternalLink> из App Store.
        </Step>
        <Step n={2}>
          <strong>Копирование:</strong> Нажми <CopySubscriptionLink subscriptionUrl={subscriptionUrl} /> или отсканируй{" "}
          <QrCodeLink subscriptionUrl={subscriptionUrl} onOpenQr={() => setQrOpen(true)} />.
        </Step>
        <Step n={3}>
          <strong>Импорт:</strong> Открой приложение. На главной странице внизу слева нажми «Из буфера». Или отсканируй
          QR-Code.
        </Step>
        <Step n={4}>
          <strong>Запуск:</strong> Выбери сервер и включи основной тумблер.
        </Step>
        <ActionButtons onScreenshots={handleScreenshots} />
      </div>
    ),
    windows: (
      <div className="flex flex-col gap-3">
        <Step n={1}>
          <strong>Установка:</strong> Скачай и установи{" "}
          <ExternalLink href="https://disk.yandex.ru/d/16xq7Y-keHg1nQ">инсталлятор</ExternalLink>.
        </Step>
        <Step n={2}>
          <strong>Копирование:</strong> Нажми <CopySubscriptionLink subscriptionUrl={subscriptionUrl} />.
        </Step>
        <Step n={3}>
          <strong>Импорт:</strong> Запусти Happ и вставь ссылку подписки в поле ввода.
        </Step>
        <Step n={4}>
          <strong>Запуск:</strong> Выбери локацию и нажми Connect.
        </Step>
        <ActionButtons onScreenshots={handleScreenshots} />
      </div>
    ),
    linux: (
      <div className="flex flex-col gap-3">
        <Step n={1}>
          <strong>Установка:</strong> Скачай пакет для своей системы и установи его:{" "}
          <ExternalLink href="https://disk.yandex.ru/d/GoscFb_zsFYN8A">.deb</ExternalLink>,{" "}
          <ExternalLink href="https://disk.yandex.ru/d/SB06qEHDMPFY0A">.rpm</ExternalLink>{" "}
          или{" "}
          <ExternalLink href="https://disk.yandex.ru/d/cOTi2cIomWiq8A">.pkg</ExternalLink>.
        </Step>
        <Step n={2}>
          <strong>Копирование:</strong> Нажми <CopySubscriptionLink subscriptionUrl={subscriptionUrl} />.
        </Step>
        <Step n={3}>
          <strong>Импорт:</strong> Запусти Happ и вставь ссылку подписки в поле ввода.
        </Step>
        <Step n={4}>
          <strong>Запуск:</strong> Нажми Connect.
        </Step>
        <ActionButtons onScreenshots={handleScreenshots} />
      </div>
    ),
    appletv: (
      <div className="flex flex-col gap-3">
        <Step n={1}>
          <strong>Установка:</strong> Найди в App Store приложение <strong>Happ</strong> и установи его{" "}
          <ExternalLink href="https://apps.apple.com/us/app/happ-proxy-utility-for-tv/id6748297274">App Store</ExternalLink>.
        </Step>
        <Step n={2}>
          <strong>Подготовка:</strong> Запусти приложение на ТВ — на экране появится QR-код.
        </Step>
        <Step n={3}>
          <strong>Передача:</strong> Открой Happ на смартфоне, отсканируй этот QR-код, выдели нужную подписку и нажми кнопку «Передать».
        </Step>
        <Step n={4}>
          <strong>Запуск:</strong> На ТВ выбери полученную подписку и нажми кнопку подключения.
        </Step>
        <ActionButtons onScreenshots={handleScreenshots} />
      </div>
    ),
    androidtv: (
      <div className="flex flex-col gap-3">
        <Step n={1}>
          <strong>Установка:</strong> Установи Happ из{" "}
          <ExternalLink href="https://play.google.com/store/apps/details?id=com.happproxy">Google Play</ExternalLink> или <ExternalLink href="https://disk.yandex.ru/d/u_d6cVaTVnyWuw">Скачай APK</ExternalLink>.
        </Step>
        <Step n={2}>
          <strong>Подготовка:</strong> Запусти приложение на ТВ — на экране появится QR-код.
        </Step>
        <Step n={3}>
          <strong>Передача:</strong> Открой Happ на смартфоне, отсканируй этот QR-код, выдели нужную подписку и нажми кнопку «Передать».
        </Step>
        <Step n={4}>
          <strong>Запуск:</strong> На ТВ выбери полученную подписку и нажми кнопку подключения.
        </Step>
        <ActionButtons onScreenshots={handleScreenshots} />
      </div>
    ),
  };

  const useSimplifiedPhone = client.layout === "dropdown" && (platform === "android" || platform === "ios");

  const mobileAndroidSimplified = (
    <div className="flex flex-col gap-3">
      <Step n={1}>
        <strong>Установка:</strong>{" "}
        <ExternalLink href="https://play.google.com/store/apps/details?id=com.happproxy">Google Play</ExternalLink>{" "}
        или{" "}
        <ExternalLink href="https://disk.yandex.ru/d/u_d6cVaTVnyWuw">Скачай APK</ExternalLink>.
      </Step>
      <Step n={2}>
        <strong>Настройка:</strong> нажми кнопку
        <OneClickAddButton subscriptionUrl={subscriptionUrl} />
      </Step>
      <Step n={3}>
        <strong>Запуск:</strong> выбери сервер и нажми кнопку подключения.
      </Step>
      <ActionButtons onScreenshots={handleScreenshots} />
    </div>
  );

  const mobileIosSimplified = (
    <div className="flex flex-col gap-3">
      <Step n={1}>
        <strong>Установка:</strong> установи{" "}
        <ExternalLink href="https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973">Happ</ExternalLink> из App Store.
      </Step>
      <Step n={2}>
        <strong>Настройка:</strong> нажми кнопку
        <OneClickAddButton subscriptionUrl={subscriptionUrl} />
      </Step>
      <Step n={3}>
        <strong>Запуск:</strong> выбери сервер и нажми кнопку подключения.
      </Step>
      <ActionButtons onScreenshots={handleScreenshots} />
    </div>
  );

  const instructionBody = useSimplifiedPhone
    ? platform === "android"
      ? mobileAndroidSimplified
      : mobileIosSimplified
    : desktopContent[platform];

  const currentScreenshots = screenshotsByPlatform[platform];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Инструкции по подключению</DialogTitle>
          <DialogDescription>
            {client.layout === "dropdown"
              ? "Выбери платформу в списке и следуй шагам"
              : "Выбери свою платформу для настройки"}
          </DialogDescription>
        </DialogHeader>

        {client.layout === "dropdown" ? (
          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">Платформа</span>
            <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <SelectTrigger className="w-full" aria-label="Платформа">
                <SelectValue placeholder="Выберите платформу" />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[60]">
                {platforms.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      {React.cloneElement(p.icon as React.ReactElement<{ className?: string }>, {
                        className: "h-4 w-4 shrink-0",
                      })}
                      {p.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {platforms.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlatform(p.id)}
                className={`flex w-full flex-col items-center gap-1.5 rounded-xl p-3 text-xs font-semibold transition-all ${
                  platform === p.id
                    ? "bg-primary text-primary-foreground ring-2 ring-primary/40"
                    : "bg-card text-muted-foreground ring-1 ring-border hover:bg-primary/10"
                }`}
              >
                {p.icon}
                <span className="whitespace-nowrap text-center leading-tight">{p.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-card p-4 ring-1 ring-border">{instructionBody}</div>
      </DialogContent>

      {/* Screenshots gallery */}
      {currentScreenshots && (
        <ScreenshotGallery
          images={currentScreenshots}
          open={screenshotsOpen}
          onOpenChange={setScreenshotsOpen}
          large={platform === "windows" || platform === "linux"}
        />
      )}

      {/* QR dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>QR-Code подписки</DialogTitle>
            <DialogDescription>
              Откройте приложение Happ, нажмите кнопку QR-Code в правом нижнем углу и отскануйте данный код.
            </DialogDescription>
          </DialogHeader>
          {subscriptionUrl ? (
            <div className="flex flex-col items-center gap-3 pt-2">
              <div className="rounded-xl bg-white p-4 ring-1 ring-border">
                <img
                  alt="QR-Code"
                  className="h-52 w-52"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                    subscriptionUrl,
                  )}`}
                />
              </div>
              <Button variant="outline" className="w-full" onClick={() => setQrOpen(false)}>
                Закрыть
              </Button>
            </div>
          ) : (
            <p className="pt-2 text-sm text-muted-foreground">Ссылка подписки недоступна</p>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};

export default InstructionsModal;
