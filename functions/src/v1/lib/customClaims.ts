import { getAuth } from "firebase-admin/auth";
import { CustomClaimsSchema, type CustomClaims } from "../schemas/domain/user.schema";

/**
 * Set custom claims for a user
 */
export async function setCustomClaims(uid: string, claims: CustomClaims): Promise<void> {
  const validated = CustomClaimsSchema.parse(claims);
  await getAuth().setCustomUserClaims(uid, validated);
}

/**
 * Get custom claims for a user
 */
export async function getCustomClaims(uid: string): Promise<CustomClaims> {
  const user = await getAuth().getUser(uid);
  return CustomClaimsSchema.parse(user.customClaims || {});
}

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(claims: CustomClaims, roles: Array<keyof CustomClaims>): boolean {
  return roles.some(role => claims[role] === true);
}

/**
 * Check if user has all of the specified roles
 */
export function hasAllRoles(claims: CustomClaims, roles: Array<keyof CustomClaims>): boolean {
  return roles.every(role => claims[role] === true);
}

/**
 * Check if user is super admin
 */
export function isSuperAdmin(claims: CustomClaims): boolean {
  return claims.super_admin === true;
}

/**
 * Check if user is any type of admin
 */
export function isAdmin(claims: CustomClaims): boolean {
  return claims.super_admin === true || claims.admin === true;
}

/**
 * Check if user is moderator or above
 */
export function isModerator(claims: CustomClaims): boolean {
  return claims.super_admin === true || claims.admin === true || claims.moderator === true;
}
