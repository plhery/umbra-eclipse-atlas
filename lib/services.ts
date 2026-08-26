import type { Coordinates, SelectedLocation } from './eclipse';
import { destinationPoint } from './eclipse';

export type PlaceResult = {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
};

export type HorizonSample = Coordinates & {
  distanceKm: number;
  elevation: number;
  apparentAngle: number;
};

export type HorizonProfile = {
  bearing: number;
  distanceKm: number;
  samples: HorizonSample[];
  maxTerrainAngle: number;
  clearance: number;
  obstructed: boolean;
};

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchElevation(lat: number, lon: number) {
  const data = await fetchJson<{ elevation?: number[] }>(
    `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(6)}&longitude=${lon.toFixed(6)}`,
  );
  return Number(data.elevation?.[0] ?? 0);
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '6',
    addressdetails: '1',
  });
  const data = await fetchJson<
    Array<{
      place_id: number;
      display_name: string;
      name?: string;
      lat: string;
      lon: string;
      type?: string;
    }>
  >(`/api/geocode?${params.toString()}`);
  return data.map((place) => {
    const parts = place.display_name.split(',').map((part) => part.trim());
    return {
      id: String(place.place_id),
      name: place.name || parts[0],
      subtitle: parts.slice(place.name ? 1 : 1, 4).join(', '),
      lat: Number(place.lat),
      lon: Number(place.lon),
    };
  });
}

export async function reverseGeocode(lat: number, lon: number) {
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    format: 'jsonv2',
    zoom: '10',
  });
  const data = await fetchJson<{
    display_name?: string;
    name?: string;
    address?: Record<string, string>;
  }>(`/api/geocode?${params.toString()}`);
  const address = data.address ?? {};
  return (
    data.name ||
    address.city ||
    address.town ||
    address.village ||
    address.county ||
    data.display_name?.split(',')[0] ||
    'Selected point'
  );
}

export async function fetchHorizonProfile(
  location: SelectedLocation,
  bearing: number,
  sunAltitude: number,
): Promise<HorizonProfile> {
  const earthRadius = 6371.0088;
  const elevationKm = Math.max(0.001, location.elevation / 1000);
  const geometricHorizon = earthRadius * Math.acos(earthRadius / (earthRadius + elevationKm));
  const distanceKm = Math.max(20, Math.min(200, geometricHorizon * 1.5));
  const sampleCount = 96;
  const points: HorizonSample[] = [];
  const coordinates = Array.from({ length: sampleCount }, (_, index) => {
    const distance = (index / (sampleCount - 1)) * distanceKm;
    return { point: destinationPoint(location, bearing, distance), distance };
  });
  const latitudes = coordinates.map(({ point }) => point.lat.toFixed(5)).join(',');
  const longitudes = coordinates.map(({ point }) => point.lon.toFixed(5)).join(',');
  const data = await fetchJson<{ elevation?: number[] }>(
    `https://api.open-meteo.com/v1/elevation?latitude=${latitudes}&longitude=${longitudes}`,
    12_000,
  );
  const elevations = data.elevation ?? [];
  let maxTerrainAngle = -90;

  coordinates.forEach(({ point, distance }, index) => {
    const elevation = Number(elevations[index] ?? 0);
    const curvatureDrop = (distance * distance) / (2 * earthRadius);
    const relativeHeightKm = (elevation - location.elevation) / 1000 - curvatureDrop;
    const apparentAngle =
      distance <= 0.01 ? -90 : (Math.atan2(relativeHeightKm, distance) * 180) / Math.PI;
    if (apparentAngle > maxTerrainAngle) maxTerrainAngle = apparentAngle;
    points.push({ ...point, distanceKm: distance, elevation, apparentAngle });
  });
  const lowerSolarLimb = sunAltitude - 0.266;
  const clearance = lowerSolarLimb - maxTerrainAngle;
  return {
    bearing,
    distanceKm,
    samples: points,
    maxTerrainAngle,
    clearance,
    obstructed: clearance < 0,
  };
}
