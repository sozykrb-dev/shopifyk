export { authEnv } from './env.js';
export type { AuthEnv } from './env.js';

export {
  PASSWORD_POLICY,
  assertStrongPassword,
  checkPasswordStrength,
  dummyVerify,
  hashPassword,
  verifyPassword,
} from './password.js';
export type { PasswordCheck, PasswordPolicy } from './password.js';

export {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  TOTP_DIGITS,
  TOTP_PERIOD,
  TOTP_WINDOW,
  createTotpSetup,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  isReplay,
  verifyTotpCode,
} from './totp.js';
export type { TotpSetup } from './totp.js';

export {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetToken,
} from './tokens.js';

export {
  SESSION_COOKIES,
  completeSessionMfa,
  cookieNameFor,
  endAllSessions,
  endSession,
  resolveSession,
  sessionMatchesContext,
  sessionPolicy,
  sessionRequiresMfa,
  startSession,
} from './session/index.js';
export type { SessionPolicy, StartSessionInput } from './session/index.js';

export {
  PERMISSION,
  assertCan,
  assertContext,
  assertStoreAccess,
  can,
  canAll,
  canAny,
  loadPrincipal,
} from './rbac/index.js';
export type { PermissionKey, Principal } from './rbac/index.js';

export {
  authenticate,
  beginTotpEnrollment,
  changePassword,
  confirmTotpEnrollment,
  disableTotp,
  hasConfirmedTotp,
  loginRateLimiter,
  verifySecondFactor,
} from './service.js';
export type { LoginInput, LoginOutcome } from './service.js';
