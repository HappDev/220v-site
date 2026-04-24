/** Поддерживаемые платформы в инструкциях по подключению. */
export type InstructionsPlatform =
  | "android"
  | "ios"
  | "windows"
  | "linux"
  | "appletv"
  | "androidtv";

export const INSTRUCTIONS_PLATFORMS: InstructionsPlatform[] = [
  "android",
  "ios",
  "windows",
  "linux",
  "appletv",
  "androidtv",
];

export function isInstructionsPlatform(value: unknown): value is InstructionsPlatform {
  return typeof value === "string" && (INSTRUCTIONS_PLATFORMS as string[]).includes(value);
}

/** Deep link для приложения Happ: добавление подписки в один клик. */
export function oneClickHappUrl(subscriptionUrl: string): string {
  return `happ://add/${encodeURIComponent(subscriptionUrl)}`;
}
