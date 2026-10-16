/**
 * Build the Cloudflare Pages preview URL for a commit in the central repo.
 * Kept pure and in one place so the URL scheme is easy to change.
 */
export function previewUrl(
  sha: string,
  domain: string,
  project: string,
): string {
  return `https://${sha.slice(0, 8)}.${domain}/${project}`;
}
