/**
 * Diagnostic endpoint: test if Tailscale Funnel is reachable from this Vercel
 * deployment. Returns the actual fetch result (status, time, error) so we
 * can verify whether the new FUNNEL_BASE hostname resolves and connects.
 *
 * Hermes 2026-09-28: ad-hoc tool to diagnose why flight.comparetiger.com
 * is still serving static-fallback after the route.ts hostname fix.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FUNNEL_HOST = 'dh4300plus-70ca-1.tail20bf1.ts.net';

export async function GET() {
  const out: Record<string, unknown> = {
    ts: new Date().toISOString(),
    funnelHost: FUNNEL_HOST,
  };

  // DNS resolve
  try {
    const dns = await fetch(`https://dns.google/resolve?name=${FUNNEL_HOST}&type=A`, {
      cache: 'no-store',
    });
    out.dnsStatus = dns.status;
    const dnsBody = await dns.json();
    out.dnsAnswer = dnsBody.Answer;
  } catch (err) {
    out.dnsError = String(err);
  }

  // Funnel fetch attempt
  const url = `https://${FUNNEL_HOST}/all_dates.json`;
  const start = Date.now();
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'flight-deals-app-diag/1.0' },
      cache: 'no-store',
    });
    clearTimeout(t);
    out.funnelStatus = res.status;
    out.funnelMs = Date.now() - start;
    const body = await res.text();
    out.funnelBodyLen = body.length;
    try {
      const parsed = JSON.parse(body);
      out.funnelFirstRoute = parsed.results?.[0]?.route;
      out.funnelFirstPendingFirstSeen = parsed.results?.[0]?.pendingFirstSeen;
    } catch {
      out.funnelBodyPreview = body.slice(0, 200);
    }
  } catch (err) {
    out.funnelError = String(err);
    out.funnelMs = Date.now() - start;
  }

  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
