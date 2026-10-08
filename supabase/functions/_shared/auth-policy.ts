type OwnerUser = { id: string; factors?: { status: string }[] };
export function requiresSecondFactor(user: OwnerUser, claims: Record<string, unknown>) {
  return claims.sub !== user.id || (user.factors?.some(factor => factor.status === 'verified') === true && claims.aal !== 'aal2');
}
