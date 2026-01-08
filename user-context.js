/**
 * User context propagated via AsyncLocalStorage.
 * Auth middleware sets it; tool handlers read it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const userContextStorage = new AsyncLocalStorage();

/** @typedef {{ sub: string; roles: string[]; scope?: string }} UserContext */

/**
 * Get the current user context from the request (set by auth middleware).
 * @returns {UserContext | null}
 */
export function getUserContext() {
  return userContextStorage.getStore() ?? null;
}

/**
 * Run fn with user attached to the async context.
 * @param {UserContext} user
 * @param {() => Promise<any>} fn
 */
export function runWithUser(user, fn) {
  return userContextStorage.run(user, fn);
}
