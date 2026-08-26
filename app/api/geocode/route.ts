const NOMINATIM = 'https://nominatim.openstreetmap.org';
const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://umbra-eclipse-atlas.plhery.chatgpt.site';
const cache = new Map<string, { body: string; expiresAt: number }>();
let nextUpstreamRequestAt = 0;

function numeric(value: string | null, min: number, max: number) {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export async function GET(request: Request) {
  const input = new URL(request.url);
  const query = input.searchParams.get('q')?.trim();
  const lat = numeric(input.searchParams.get('lat'), -90, 90);
  const lon = numeric(input.searchParams.get('lon'), -180, 180);
  const upstream = new URL(query ? '/search' : '/reverse', NOMINATIM);

  if (query && query.length >= 2) {
    upstream.searchParams.set('q', query.slice(0, 160));
    upstream.searchParams.set('format', 'jsonv2');
    upstream.searchParams.set('limit', '6');
    upstream.searchParams.set('addressdetails', '1');
  } else if (lat !== null && lon !== null) {
    upstream.searchParams.set('lat', lat.toFixed(6));
    upstream.searchParams.set('lon', lon.toFixed(6));
    upstream.searchParams.set('format', 'jsonv2');
    upstream.searchParams.set('zoom', '10');
  } else {
    return Response.json({ error: 'Provide q or valid lat/lon coordinates.' }, { status: 400 });
  }

  const cacheKey = upstream.pathname + '?' + upstream.searchParams.toString();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(cached.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=600, s-maxage=86400',
        'X-Umbra-Cache': 'hit',
      },
    });
  }

  const now = Date.now();
  if (now < nextUpstreamRequestAt) {
    return Response.json(
      { error: 'Please wait a moment before searching again.' },
      { status: 429, headers: { 'Retry-After': '1' } },
    );
  }
  nextUpstreamRequestAt = now + 1_100;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch(upstream, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        Referer: SITE_ORIGIN + '/',
        'User-Agent': 'Umbra Solar Eclipse Atlas/1.0 (+' + SITE_ORIGIN + ')',
      },
    });
  } catch {
    return Response.json({ error: 'Geocoding is temporarily unavailable.' }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return Response.json({ error: 'Geocoding is temporarily unavailable.' }, { status: 502 });
  }

  const body = await response.text();
  cache.set(cacheKey, { body, expiresAt: Date.now() + 86_400_000 });
  if (cache.size > 256) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': query
        ? 'public, max-age=600, s-maxage=86400'
        : 'public, max-age=86400, s-maxage=604800',
      'X-Umbra-Cache': 'miss',
    },
  });
}
