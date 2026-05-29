const PREFIX = "v220:";

export const sessionKey = (sid) => `${PREFIX}sess:${sid}`;
export const otpKey = (email) => `${PREFIX}otp:${email}`;
export const otpCooldownKey = (email) => `${PREFIX}otp:cooldown:${email}`;

export const refEventsListKey = () => `${PREFIX}ref:events`;
export const refEventsReferrerIndexKey = (refUuid) => `${PREFIX}ref:events:by_referrer:${refUuid}`;
export const refEventsIpIndexKey = (ipHash) => `${PREFIX}ref:events:by_ip:${ipHash}`;
export const refEventsUaIndexKey = (uaHash) => `${PREFIX}ref:events:by_ua:${uaHash}`;
export const refEventsFingerprintIndexKey = (fingerprintHash) => `${PREFIX}ref:events:by_fingerprint:${fingerprintHash}`;
export const refStatsReferrerKey = (refUuid) => `${PREFIX}ref:stats:referrer:${refUuid}`;

export const SCAN_PATTERNS = {
  otp: `${PREFIX}otp:*`,
  otpCooldown: `${PREFIX}otp:cooldown:*`,
  session: `${PREFIX}sess:*`,
  rlSendCodeIp: `${PREFIX}rl:sendcode:ip:*`,
  rlSendCodeEmail: `${PREFIX}rl:sendcode:email:*`,
  rlVerifyIp: `${PREFIX}rl:verify:ip:*`,
  rlCheckoutSid: `${PREFIX}rl:checkout:sid:*`,
  rlTalkmeIp: `${PREFIX}rl:talkme:ip:*`,
  rlTalkmeSid: `${PREFIX}rl:talkme:sid:*`,
  rlChatUploadSid: `${PREFIX}rl:chatupload:sid:*`,
  refEvents: `${PREFIX}ref:events`,
  refEventsByReferrer: `${PREFIX}ref:events:by_referrer:*`,
  refEventsByIp: `${PREFIX}ref:events:by_ip:*`,
  refEventsByUa: `${PREFIX}ref:events:by_ua:*`,
  refEventsByFingerprint: `${PREFIX}ref:events:by_fingerprint:*`,
  refStatsReferrer: `${PREFIX}ref:stats:referrer:*`,
  rlRefClickIp: `${PREFIX}rl:refclick:ip:*`,
};

export const RL_PREFIXES = {
  sendCodeIp: `${PREFIX}rl:sendcode:ip:`,
  sendCodeEmail: `${PREFIX}rl:sendcode:email:`,
  verifyIp: `${PREFIX}rl:verify:ip:`,
  checkoutSession: `${PREFIX}rl:checkout:sid:`,
  talkmeIp: `${PREFIX}rl:talkme:ip:`,
  talkmeSession: `${PREFIX}rl:talkme:sid:`,
  chatUploadSession: `${PREFIX}rl:chatupload:sid:`,
  refClickIp: `${PREFIX}rl:refclick:ip:`,
};

export const KEY_PREFIXES = {
  otp: `${PREFIX}otp:`,
  otpCooldown: `${PREFIX}otp:cooldown:`,
};
