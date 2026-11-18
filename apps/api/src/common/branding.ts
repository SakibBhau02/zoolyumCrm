/**
 * Branding is a workspace-wide singleton, but nothing in the schema enforced
 * that: every save used `findFirst()` without an order, so repeated saves (and
 * concurrent ones) left several `BrandingConfig` rows behind. Postgres is free
 * to return any of them, so a save could land on one row while the next read
 * picked another — the UI looked like "the bank details never save".
 *
 * Every reader goes through here: newest row wins, deterministically.
 */
export const BRANDING_ORDER = { updatedAt: "desc" } as const;

export function getBrandingConfig(prisma: any) {
  return prisma.brandingConfig.findFirst({ orderBy: BRANDING_ORDER });
}
