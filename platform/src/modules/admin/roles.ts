import { adminRoleEnum, type AdminRole } from './schema.js';
import type { AdminSession } from './service.js';

export const ALL_ROLES: readonly AdminRole[] = adminRoleEnum.enumValues;

// Who may open the settings of an app, and who may change them
export const SETTINGS_READERS: readonly AdminRole[] = ['owner', 'product'];
export const SETTINGS_EDITORS: readonly AdminRole[] = ['owner'];

// A grant without an app covers every app
export function hasAppRole(session: AdminSession, appId: string, roles: readonly AdminRole[]): boolean {
  return session.roles.some((grant) => roles.includes(grant.role) && (grant.appId === null || grant.appId === appId));
}

// Only grants that cover every app, e.g. for creating apps
export function hasGlobalRole(session: AdminSession, roles: readonly AdminRole[]): boolean {
  return session.roles.some((grant) => grant.appId === null && roles.includes(grant.role));
}