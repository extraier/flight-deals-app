/**
 * Full Hong Kong stay-7 calendar. Not the 30-date home feed.
 *
 *   GET /api/calendar?dep=HKG&dest=MNL
 *
 * SZX returns heatmap:false. The date pool is fli_calendar.db or
 * hkg_stay7_calendar.json under FLI_DATA_DIR (default
 * /volume1/flight-scanner). all_dates.json is intentionally ignored.
 */

import { loadHkgStayCalendar, szxCalendar } from '@/lib/calendarSource';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dep = (url.searchParams.get('dep') || 'HKG').toUpperCase();
  const dest = (url.searchParams.get('dest') || '').toUpperCase();
  if (dep === 'SZX') {
    return Response.json(szxCalendar(dest), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (dep !== 'HKG') {
    return Response.json(
      { heatmap: false, departure: dep, dest, reason: 'no-pool' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const body = await loadHkgStayCalendar(dest);
  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
