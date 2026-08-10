export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'portal',
  'health',
  'login',
  'logout',
  'auth',
  'settings',
  'rss',
  'feed',
  'sitemap',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
  'tags',
  'authors',
  'posts',
  'pages',
]);

export function slugify(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .toLowerCase()
    .trim()
    .normalize('NFD') // Separate accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric except spaces and hyphens
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with single hyphen
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Trim leading and trailing hyphens
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase().trim());
}

export async function generateUniqueSlug(
  baseText: string,
  checkExists: (candidate: string) => Promise<boolean>,
  currentId?: string
): Promise<string> {
  const baseSlug = slugify(baseText) || 'untitled';
  if (isReservedSlug(baseSlug)) {
    // If base slug is reserved, append '-1'
    let suffix = 1;
    while (true) {
      const candidate = `${baseSlug}-${suffix}`;
      if (!isReservedSlug(candidate) && !(await checkExists(candidate))) {
        return candidate;
      }
      suffix++;
    }
  }

  if (!(await checkExists(baseSlug))) {
    return baseSlug;
  }

  let counter = 2;
  while (true) {
    const candidate = `${baseSlug}-${counter}`;
    if (!(await checkExists(candidate))) {
      return candidate;
    }
    counter++;
  }
}
