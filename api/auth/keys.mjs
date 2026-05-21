const PREFIX = "v220:";

export const sessionKey = (sid) => `${PREFIX}sess:${sid}`;
export const otpKey = (email) => `${PREFIX}otp:${email}`;
export const otpCooldownKey = (email) => `${PREFIX}otp:cooldown:${email}`;

export const SCAN_PATTERNS = {
  otp: `${PREFIX}otp:*`,
  otpCooldown: `${PREFIX}otp:cooldown:*`,
  session: `${PREFIX}sess:*`,
  rlSendCodeIp: `${PREFIX}rl:sendcode:ip:*`,
  rlSendCodeEmail: `${PREFIX}rl:sendcode:email:*`,
  rlVerifyIp: `${PREFIX}rl:verify:ip:*`,
  rlCheckoutSid: `${PREFIX}rl:checkout:sid:*`,
};

export const RL_PREFIXES = {
  sendCodeIp: `${PREFIX}rl:sendcode:ip:`,
  sendCodeEmail: `${PREFIX}rl:sendcode:email:`,
  verifyIp: `${PREFIX}rl:verify:ip:`,
  checkoutSession: `${PREFIX}rl:checkout:sid:`,
};

export const KEY_PREFIXES = {
  otp: `${PREFIX}otp:`,
  otpCooldown: `${PREFIX}otp:cooldown:`,
};
