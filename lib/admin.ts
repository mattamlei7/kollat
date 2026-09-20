/** Shared-secret gate for operator endpoints until partner auth exists (plan3.0 §5 #10). Header or ?key= (for pingers that cannot set headers). */
export function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  return header === `Bearer ${secret}` || key === secret;
}
