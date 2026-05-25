const KEY_PREFIX = "v220_referrals_started:";

export function getReferralsProgramStarted(userUuid: string): boolean {
  if (!userUuid.trim()) return false;
  try {
    return localStorage.getItem(`${KEY_PREFIX}${userUuid.trim()}`) === "1";
  } catch {
    return false;
  }
}

export function setReferralsProgramStarted(userUuid: string): void {
  if (!userUuid.trim()) return;
  try {
    localStorage.setItem(`${KEY_PREFIX}${userUuid.trim()}`, "1");
  } catch {
    // ignore quota / private mode
  }
}
