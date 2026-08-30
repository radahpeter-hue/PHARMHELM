type RoleProfile = {
  role?: string | null;
  secondaryRoles?: string[] | null;
};

const normalizeRole = (role: string) => role.trim().toLowerCase();

export const getAssignedRoles = (profile?: RoleProfile | null): string[] => {
  if (!profile) return [];
  return [profile.role || '', ...(profile.secondaryRoles || [])]
    .map(normalizeRole)
    .filter(Boolean);
};

export const hasAnyRole = (profile: RoleProfile | null | undefined, roles: string[]): boolean => {
  const assigned = new Set(getAssignedRoles(profile));
  return roles.some(role => assigned.has(normalizeRole(role)));
};

export const hasRoleContaining = (profile: RoleProfile | null | undefined, fragment: string): boolean => {
  const normalized = normalizeRole(fragment);
  return getAssignedRoles(profile).some(role => role.includes(normalized));
};
