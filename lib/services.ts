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

export type HorizonSkylineSample = {
  bearing: number;
  distanceKm: number;
  elevation: number;
  apparentAngle: number;
};

export type HorizonProfile = {
  bearing: number;
  distanceKm: number;
  fieldOfView: number;
  samples: HorizonSample[];
  skyline: HorizonSkylineSample[];
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

async function fetchElevations(points: Coordinates[]) {
  const batchSize = 90;
  const batches = Array.from(
    { length: Math.ceil(points.length / batchSize) },
    (_, index) => points.slice(index * batchSize, (index + 1) * batchSize),
  );
  const results: number[] = [];

  // Open-Meteo throttles bursts of parallel elevation requests. Keeping these
  // batches sequential is a little slower, but makes the user-triggered scan
  // dependable on both cellular and desktop connections.
  for (const [batchIndex, batch] of batches.entries()) {
    const latitudes = batch.map((point) => point.lat.toFixed(5)).join(',');
    const longitudes = batch.map((point) => point.lon.toFixed(5)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitudes}&longitude=${longitudes}`;
    let data: { elevation?: number[] } | undefined;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        data = await fetchJson<{ elevation?: number[] }>(url, 12_000);
        break;
      } catch (error) {
        const throttled = error instanceof Error && error.message.includes('429');
        if (!throttled || attempt === 2) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 650 * (attempt + 1)));
      }
    }

    if (!data) throw new Error('Elevation response was empty');
    results.push(...batch.map((_, index) => Number(data.elevation?.[index] ?? 0)));
    if (batchIndex < batches.length - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }

  return results;
}

function apparentTerrainAngle(
  distanceKm: number,
  elevation: number,
  observerElevation: number,
) {
  const earthRadius = 6371.0088;
  const curvatureDrop = (distanceKm * distanceKm) / (2 * earthRadius);
  const relativeHeightKm = (elevation - observerElevation) / 1000 - curvatureDrop;
  return (Math.atan2(relativeHeightKm, distanceKm) * 180) / Math.PI;
}

function spacedDistances(count: number, minimum: number, maximum: number) {
  return Array.from({ length: count }, (_, index) => {
    const progress = count === 1 ? 1 : index / (count - 1);
    return minimum + (maximum - minimum) * Math.pow(progress, 1.7);
  });
}

export async function fetchHorizonProfile(
  location: Pick<SelectedLocation, 'lat' | 'lon' | 'elevation'>,
  bearing: number,
  sunAltitude: number,
): Promise<HorizonProfile> {
  const earthRadius = 6371.0088;
  const elevationKm = Math.max(0.001, location.elevation / 1000);
  const geometricHorizon = earthRadius * Math.acos(earthRadius / (earthRadius + elevationKm));
  const distanceKm = Math.max(60, Math.min(200, geometricHorizon * 1.5));
  const rayDistances = spacedDistances(64, 0.15, distanceKm);
  const rayCoordinates = rayDistances.map((distance) => {
    return { point: destinationPoint(location, bearing, distance), distance };
  });
  const fieldOfView = 90;
  const skylineBearings = Array.from({ length: 33 }, (_, index) => {
    return (bearing - fieldOfView / 2 + (index / 32) * fieldOfView + 360) % 360;
  });
  const skylineDistances = spacedDistances(14, 0.25, distanceKm);
  const skylineCoordinates = skylineBearings.flatMap((skylineBearing) =>
    skylineDistances.map((distance) => ({
      point: destinationPoint(location, skylineBearing, distance),
      distance,
      bearing: skylineBearing,
    })),
  );
  const allCoordinates = [
    ...rayCoordinates.map(({ point }) => point),
    ...skylineCoordinates.map(({ point }) => point),
  ];
  const elevations = await fetchElevations(allCoordinates);
  const samples = rayCoordinates.map(({ point, distance }, index) => {
    const elevation = elevations[index] ?? 0;
    return {
      ...point,
      distanceKm: distance,
      elevation,
      apparentAngle: apparentTerrainAngle(distance, elevation, location.elevation),
    };
  });
  const maxTerrainAngle = Math.max(...samples.map((sample) => sample.apparentAngle));
  const skylineOffset = rayCoordinates.length;
  const skyline = skylineBearings.map((skylineBearing, bearingIndex) => {
    const start = skylineOffset + bearingIndex * skylineDistances.length;
    const candidates = skylineDistances.map((distance, distanceIndex) => {
      const elevation = elevations[start + distanceIndex] ?? 0;
      return {
        bearing: skylineBearing,
        distanceKm: distance,
        elevation,
        apparentAngle: apparentTerrainAngle(distance, elevation, location.elevation),
      };
    });
    return candidates.reduce((highest, candidate) =>
      candidate.apparentAngle > highest.apparentAngle ? candidate : highest,
    );
  });
  const lowerSolarLimb = sunAltitude - 0.266;
  const clearance = lowerSolarLimb - maxTerrainAngle;
  return {
    bearing,
    distanceKm,
    fieldOfView,
    samples,
    skyline,
    maxTerrainAngle,
    clearance,
    obstructed: clearance < 0,
  };
}
