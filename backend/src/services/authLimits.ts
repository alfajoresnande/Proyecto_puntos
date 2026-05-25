const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type AuthRateLimitRule = {
  key: string;
  limit: number;
  windowSeconds: number;
};

export const AUTH_RATE_LIMITS = {
  login: {
    email: { limit: 10, windowSeconds: HOUR },
    user: { limit: 10, windowSeconds: HOUR },
    device: { limit: 20, windowSeconds: HOUR },
    ip: { limit: 50, windowSeconds: HOUR },
    emailIp: { limit: 5, windowSeconds: 15 * MINUTE },
  },
  google: {
    device: { limit: 20, windowSeconds: HOUR },
    ip: { limit: 50, windowSeconds: HOUR },
  },
  register: {
    email: { limit: 3, windowSeconds: DAY },
    device: { limit: 3, windowSeconds: DAY },
    ip: { limit: 10, windowSeconds: HOUR },
    ipDay: { limit: 30, windowSeconds: DAY },
    emailIp: { limit: 2, windowSeconds: HOUR },
  },
  confirmRegister: {
    ip: { limit: 20, windowSeconds: HOUR },
    device: { limit: 10, windowSeconds: HOUR },
    token: { limit: 5, windowSeconds: HOUR },
  },
  passwordReset: {
    email: { limit: 3, windowSeconds: HOUR },
    emailDay: { limit: 5, windowSeconds: DAY },
    user: { limit: 3, windowSeconds: HOUR },
    userDay: { limit: 5, windowSeconds: DAY },
    device: { limit: 3, windowSeconds: HOUR },
    ip: { limit: 10, windowSeconds: HOUR },
    ipDay: { limit: 30, windowSeconds: DAY },
    emailIp: { limit: 2, windowSeconds: HOUR },
  },
  resetConfirm: {
    ip: { limit: 20, windowSeconds: HOUR },
    device: { limit: 10, windowSeconds: HOUR },
    token: { limit: 5, windowSeconds: HOUR },
  },
  passwordChangeAttempt: {
    user: { limit: 5, windowSeconds: HOUR },
    device: { limit: 5, windowSeconds: HOUR },
    ip: { limit: 10, windowSeconds: HOUR },
  },
  passwordChange: {
    user: { limit: 3, windowSeconds: DAY },
  },
} as const;

export function loginLimitKeys(input: { emailHash: string; ip: string; deviceId: string }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.login;
  return [
    { key: `email:${input.emailHash}`, ...limits.email },
    { key: `device:${input.deviceId}`, ...limits.device },
    { key: `ip:${input.ip}`, ...limits.ip },
    { key: `email_ip:${input.emailHash}:${input.ip}`, ...limits.emailIp },
  ];
}

export function loginUserLimitKeys(input: { userId: number }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.login;
  return [{ key: `user:${input.userId}`, ...limits.user }];
}

export function googleLimitKeys(input: { ip: string; deviceId: string }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.google;
  return [
    { key: `device:${input.deviceId}`, ...limits.device },
    { key: `ip:${input.ip}`, ...limits.ip },
  ];
}

export function registerLimitKeys(input: { emailHash: string; ip: string; deviceId: string }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.register;
  return [
    { key: `email:${input.emailHash}`, ...limits.email },
    { key: `device:${input.deviceId}`, ...limits.device },
    { key: `ip:${input.ip}`, ...limits.ip },
    { key: `ip_day:${input.ip}`, ...limits.ipDay },
    { key: `email_ip:${input.emailHash}:${input.ip}`, ...limits.emailIp },
  ];
}

export function confirmRegisterLimitKeys(input: { tokenHash: string; ip: string; deviceId: string }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.confirmRegister;
  return [
    { key: `ip:${input.ip}`, ...limits.ip },
    { key: `device:${input.deviceId}`, ...limits.device },
    { key: `token:${input.tokenHash}`, ...limits.token },
  ];
}

export function passwordResetLimitKeys(input: { emailHash: string; ip: string; deviceId: string }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.passwordReset;
  return [
    { key: `email:${input.emailHash}`, ...limits.email },
    { key: `email_day:${input.emailHash}`, ...limits.emailDay },
    { key: `device:${input.deviceId}`, ...limits.device },
    { key: `ip:${input.ip}`, ...limits.ip },
    { key: `ip_day:${input.ip}`, ...limits.ipDay },
    { key: `email_ip:${input.emailHash}:${input.ip}`, ...limits.emailIp },
  ];
}

export function passwordResetUserLimitKeys(input: { userId: number }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.passwordReset;
  return [
    { key: `user:${input.userId}`, ...limits.user },
    { key: `user_day:${input.userId}`, ...limits.userDay },
  ];
}

export function resetConfirmLimitKeys(input: { tokenHash: string; ip: string; deviceId: string }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.resetConfirm;
  return [
    { key: `ip:${input.ip}`, ...limits.ip },
    { key: `device:${input.deviceId}`, ...limits.device },
    { key: `token:${input.tokenHash}`, ...limits.token },
  ];
}

export function passwordChangeAttemptLimitKeys(input: { userId: number; ip: string; deviceId: string }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.passwordChangeAttempt;
  return [
    { key: `user_attempt:${input.userId}`, ...limits.user },
    { key: `device:${input.deviceId}`, ...limits.device },
    { key: `ip:${input.ip}`, ...limits.ip },
  ];
}

export function passwordChangeLimitKeys(input: { userId: number }): AuthRateLimitRule[] {
  const limits = AUTH_RATE_LIMITS.passwordChange;
  return [{ key: `user:${input.userId}`, ...limits.user }];
}
