import { Location, TimeOfInterest } from '@astronomy-bundle/core';
import {
  LocalEclipseCircumstances,
  SolarEclipse,
} from '@astronomy-bundle/solar-eclipse';
import { Catalogue as StandardCatalogue } from '@astronomy-bundle/solar-eclipse/catalogue';

export type Coordinates = { lat: number; lon: number };
export type SelectedLocation = Coordinates & {
  elevation: number;
  name: string;
  accuracy?: number;
};
export type EclipseKind = 'total' | 'annular' | 'hybrid' | 'partial';
export type LocalEclipseKind = 'total' | 'annular' | 'partial' | 'none';
export type BesselianElements = ReturnType<
  typeof StandardCatalogue.getBesselianElements
>;

export type EclipseGeometry = {
  centralLine: Coordinates[];
  umbra: Coordinates[];
  penumbra: Coordinates[];
  sunrise: Coordinates[];
  sunset: Coordinates[];
};

export type EclipseData = {
  date: string;
  type: EclipseKind;
  saros: number;
  gamma: number;
  magnitude: number;
  obscuration: number;
  moonSunRatio: number;
  pathWidthMeters: number;
  durationSeconds: number;
  centralDurationSeconds: number;
  greatest: Coordinates;
  greatestTime: Date;
  rangeStart: Date;
  rangeEnd: Date;
  elements: BesselianElements;
  eclipse: SolarEclipse;
  geometry: EclipseGeometry;
};

export type ContactEvent = {
  key: 'sunrise' | 'c1' | 'c2' | 'max' | 'c3' | 'c4' | 'sunset';
  label: string;
  shortLabel: string;
  date: Date;
  altitude: number;
  azimuth: number;
  magnitude: number;
  obscuration: number;
};

export type LocalResult = {
  type: LocalEclipseKind;
  magnitude: number;
  obscuration: number;
  moonSunRatio: number;
  durationSeconds: number;
  centralDurationSeconds: number;
  pathWidthMeters: number;
  centerDistanceKm: number;
  edgeDistanceKm: number;
  centerBearing: number;
  contacts: ContactEvent[];
  maximum: ContactEvent | null;
  localEclipse: ReturnType<SolarEclipse['getLocalEclipse']> | null;
};

export type CatalogEntry = {
  date: string;
  type: EclipseKind;
  saros: number;
  durationSeconds: number;
  magnitude: number;
};

export type UpcomingLocalEclipse = {
  date: string;
  type: Exclude<LocalEclipseKind, 'none'>;
  maximum: Date;
  magnitude: number;
  obscuration: number;
  altitude: number;
  durationSeconds: number;
};

export type UpcomingLocalEclipses = {
  totals: UpcomingLocalEclipse[];
  partials: UpcomingLocalEclipse[];
  throughYear: number;
};

type ShadowTrackPoint = {
  point: Coordinates;
  maximumMs: number;
};

const shadowTrackCache = new WeakMap<
  EclipseData,
  { start: number; end: number; points: ShadowTrackPoint[] } | null
>();

const EVENT_NOTES: Record<string, string> = {
  '2017-08-21': 'United States',
  '2019-07-02': 'Chile & Argentina',
  '2020-12-14': 'Chile & Argentina',
  '2021-12-04': 'Antarctica',
  '2023-04-20': 'Western Australia & Indonesia',
  '2023-10-14': 'United States to Brazil',
  '2024-04-08': 'Mexico, United States & Canada',
  '2024-10-02': 'Pacific Ocean & Patagonia',
  '2025-03-29': 'North Atlantic & Arctic',
  '2025-09-21': 'South Pacific & Antarctica',
  '2026-02-17': 'Antarctica',
  '2026-08-12': 'Greenland, Iceland & Spain',
  '2027-02-06': 'Patagonia & the South Atlantic',
  '2027-08-02': 'Spain, North Africa & the Middle East',
  '2028-01-26': 'Ecuador, Peru & Brazil',
  '2028-07-22': 'Australia & New Zealand',
  '2030-06-01': 'North Africa, Europe & Russia',
  '2030-11-25': 'Southern Africa & Australia',
  '2031-05-21': 'Africa, India & Southeast Asia',
  '2031-11-14': 'Pacific Ocean',
  '2032-05-09': 'South Atlantic',
  '2033-03-30': 'Alaska & Arctic Canada',
  '2034-03-20': 'Africa, Arabia & Asia',
  '2034-09-12': 'South America & South Atlantic',
  '2035-03-09': 'New Zealand & Pacific Ocean',
  '2035-09-02': 'China, Korea & Japan',
};

export function eventRegion(date: string, greatest?: Coordinates) {
  if (EVENT_NOTES[date]) return EVENT_NOTES[date];
  if (!greatest) return 'Across Earth';
  return `Greatest near ${formatCoordinate(greatest.lat, true)}, ${formatCoordinate(greatest.lon, false)}`;
}

export function eventTitle(type: EclipseKind, date: string) {
  const region = EVENT_NOTES[date];
  if (type === 'annular' && region) return `A ring of fire over ${region}`;
  if (type === 'total' && region) return `Totality across ${region}`;
  if (type === 'hybrid' && region) return `A rare hybrid eclipse over ${region}`;
  const names: Record<EclipseKind, string> = {
    total: 'Total solar eclipse',
    annular: 'Annular solar eclipse',
    hybrid: 'Hybrid solar eclipse',
    partial: 'Partial solar eclipse',
  };
  return names[type];
}

export function getNextSolarEclipseDate(now = new Date()) {
  const year = now.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return StandardCatalogue.getAvailableEclipseDates(
    `${year}-${month}-${day}`,
    '2100-12-31',
  )[0] ?? null;
}

export async function catalogueForDate(date: string) {
  const year = parseEclipseDate(date).year;
  if (year >= 1900 && year <= 2100) return StandardCatalogue;
  return (await import('@astronomy-bundle/solar-eclipse/catalogue-full')).Catalogue;
}

export async function getAdjacentEclipseDate(
  date: string,
  direction: -1 | 1,
) {
  const { year } = parseEclipseDate(date);
  const catalogue = (await import('@astronomy-bundle/solar-eclipse/catalogue-full')).Catalogue;
  const from = `${formatAstronomicalYear(Math.max(-1999, year - 2))}-01-01`;
  const to = `${formatAstronomicalYear(Math.min(3000, year + 2))}-12-31`;
  const dates = catalogue.getAvailableEclipseDates(from, to);
  const index = dates.indexOf(date);
  if (index < 0) return null;
  return dates[index + direction] ?? null;
}

function makeUtcDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(hour, minute, second, 0);
  return result;
}

export function parseEclipseDate(date: string) {
  const match = date.match(/^(-?\d+)-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid eclipse date: ${date}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export async function loadEclipse(date: string): Promise<EclipseData> {
  const catalogue = await catalogueForDate(date);
  const elements = catalogue.getBesselianElements(date);
  const eclipse = SolarEclipse.createFromBesselianElements(elements);
  const { year, month, day } = parseEclipseDate(date);
  const base = makeUtcDate(year, month, day, elements.t0Hours);

  return {
    date,
    type: eclipse.getType() as EclipseKind,
    saros: eclipse.getSaros(),
    gamma: eclipse.getGamma(),
    magnitude: eclipse.getMaxMagnitude(),
    obscuration: eclipse.getMaxObscuration(),
    moonSunRatio: eclipse.getMaxMoonSunRatio(),
    pathWidthMeters: eclipse.getUmbraPathWidth(),
    durationSeconds: eclipse.getMaxDuration(),
    centralDurationSeconds: eclipse.getMaxCentralDuration(),
    greatest: eclipse.getLocationOfGreatestEclipse(),
    greatestTime: eclipse.getTimeOfGreatestEclipse().getDate(),
    rangeStart: new Date(base.getTime() + elements.tMin * 3_600_000),
    rangeEnd: new Date(base.getTime() + elements.tMax * 3_600_000),
    elements,
    eclipse,
    geometry: {
      centralLine: eclipse.getCentralLine({ stepsInSeconds: 20 }),
      umbra: eclipse.getUmbraPathPolygon({ stepsInSeconds: 20 }),
      penumbra: eclipse.getPenumbraPathPolygon({ refraction: true }),
      sunrise: eclipse.getSunriseBoundaryPolygon({ refraction: true }),
      sunset: eclipse.getSunsetBoundaryPolygon({ refraction: true }),
    },
  };
}

export async function searchCatalogue(
  fromYear: number,
  toYear: number,
  onProgress?: (progress: number) => void,
  visibility?: {
    location: SelectedLocation;
    centralOnly: boolean;
  },
) {
  const useStandard = fromYear >= 1900 && toYear <= 2100;
  const catalogue = useStandard
    ? StandardCatalogue
    : (await import('@astronomy-bundle/solar-eclipse/catalogue-full')).Catalogue;
  const from = `${formatAstronomicalYear(fromYear)}-01-01`;
  const to = `${formatAstronomicalYear(toYear)}-12-31`;
  const dates = catalogue.getAvailableEclipseDates(from, to);
  const results: CatalogEntry[] = [];

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const eclipse = SolarEclipse.createFromBesselianElements(
      catalogue.getBesselianElements(date),
    );
    let include = true;
    if (visibility) {
      try {
        const local = eclipse.getLocalEclipse(
          Location.create(
            visibility.location.lat,
            visibility.location.lon,
            visibility.location.elevation,
          ),
        );
        const localType = local.getType();
        if (localType === 'none') include = false;
        if (visibility.centralOnly && localType === 'partial') include = false;
      } catch {
        include = false;
      }
    }
    if (include) {
      results.push({
        date,
        type: eclipse.getType() as EclipseKind,
        saros: eclipse.getSaros(),
        durationSeconds: eclipse.getMaxCentralDuration(),
        magnitude: eclipse.getMaxMagnitude(),
      });
    }
    if (index % 75 === 0) {
      onProgress?.(index / Math.max(1, dates.length));
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  onProgress?.(1);
  return results;
}

export async function findUpcomingEclipsesAtLocation(
  location: Pick<SelectedLocation, 'lat' | 'lon' | 'elevation'>,
  afterDate: string,
  totalLimit = 2,
  partialLimit = 3,
): Promise<UpcomingLocalEclipses> {
  const catalogue = (await import('@astronomy-bundle/solar-eclipse/catalogue-full')).Catalogue;
  const dates = catalogue.getAvailableEclipseDates(afterDate, '3000-12-31');
  const observer = Location.create(location.lat, location.lon, location.elevation);
  const after = parseEclipseDate(afterDate);
  const afterValue = after.year * 372 + after.month * 31 + after.day;
  const totals: UpcomingLocalEclipse[] = [];
  const partials: UpcomingLocalEclipse[] = [];

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const parsed = parseEclipseDate(date);
    if (parsed.year * 372 + parsed.month * 31 + parsed.day <= afterValue) continue;

    try {
      const eclipse = SolarEclipse.createFromBesselianElements(
        catalogue.getBesselianElements(date),
      );
      const localEclipse = eclipse.getLocalEclipse(observer);
      const type = localEclipse.getType() as LocalEclipseKind;
      if (type === 'none' || type === 'annular') continue;

      const maximum = localEclipse.getContactTimes()?.max;
      if (!maximum) continue;
      const circumstances = localEclipse.getCircumstances(maximum);
      const horizontal = circumstances.getApparentTopocentricHorizontalCoordinates();
      if (horizontal.altitude < -0.833) continue;

      const item: UpcomingLocalEclipse = {
        date,
        type,
        maximum: maximum.getDate(),
        magnitude: Math.max(0, circumstances.getMagnitude()),
        obscuration: Math.max(0, circumstances.getObscuration()),
        altitude: horizontal.altitude,
        durationSeconds:
          type === 'total' ? localEclipse.getCentralDuration() : localEclipse.getDuration(),
      };
      if (type === 'total' && totals.length < totalLimit) totals.push(item);
      if (type === 'partial' && partials.length < partialLimit) partials.push(item);
      if (totals.length >= totalLimit && partials.length >= partialLimit) break;
    } catch {
      // Some edge-of-path circumstances are not numerically stable; skip them.
    }

    if (index % 80 === 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }

  return { totals, partials, throughYear: 3000 };
}

export function computeLocalResult(
  data: EclipseData,
  selected: SelectedLocation,
): LocalResult {
  const observer = Location.create(selected.lat, selected.lon, selected.elevation);
  let localEclipse: ReturnType<SolarEclipse['getLocalEclipse']>;
  try {
    localEclipse = data.eclipse.getLocalEclipse(observer);
  } catch {
    const center = data.geometry.centralLine.length
      ? nearestCoordinate(selected, data.geometry.centralLine)
      : null;
    const edgePath = data.geometry.umbra.length
      ? data.geometry.umbra
      : data.geometry.penumbra;
    const edge = edgePath.length
      ? nearestCoordinate(selected, edgePath)
      : null;
    return {
      type: 'none',
      magnitude: 0,
      obscuration: 0,
      moonSunRatio: 0,
      durationSeconds: 0,
      centralDurationSeconds: 0,
      pathWidthMeters: 0,
      centerDistanceKm: center?.distanceKm ?? Number.NaN,
      edgeDistanceKm: edge?.distanceKm ?? Number.NaN,
      centerBearing: center ? initialBearing(selected, center.point) : Number.NaN,
      contacts: [],
      maximum: null,
      localEclipse: null,
    };
  }

  const times = localEclipse.getContactTimes();
  const localType = localEclipse.getType() as LocalEclipseKind;
  const contacts: ContactEvent[] = [];
  const labels: Record<ContactEvent['key'], [string, string]> = {
    sunrise: ['Sunrise', 'Rise'],
    c1: ['Partial eclipse begins', 'C1'],
    c2: ['Central eclipse begins', 'C2'],
    max: ['Maximum eclipse', 'Max'],
    c3: ['Central eclipse ends', 'C3'],
    c4: ['Partial eclipse ends', 'C4'],
    sunset: ['Sunset', 'Set'],
  };

  if (times) {
    (Object.keys(labels) as ContactEvent['key'][]).forEach((key) => {
      const toi = times[key];
      if (!toi) return;
      const circumstances = localEclipse.getCircumstances(toi);
      const horizontal = circumstances.getApparentTopocentricHorizontalCoordinates();
      contacts.push({
        key,
        label: labels[key][0],
        shortLabel: labels[key][1],
        date: toi.getDate(),
        altitude: horizontal.altitude,
        azimuth: horizontal.azimuth,
        magnitude: Math.max(0, circumstances.getMagnitude()),
        obscuration: Math.max(0, circumstances.getObscuration()),
      });
    });
  }
  contacts.sort((a, b) => a.date.getTime() - b.date.getTime());
  const center = data.geometry.centralLine.length
    ? nearestCoordinate(selected, data.geometry.centralLine)
    : null;
  const edgePath = data.geometry.umbra.length
    ? data.geometry.umbra
    : data.geometry.penumbra;
  const edge = edgePath.length
    ? nearestCoordinate(selected, edgePath)
    : null;

  if (localType === 'none') {
    return {
      type: 'none',
      magnitude: 0,
      obscuration: 0,
      moonSunRatio: 0,
      durationSeconds: 0,
      centralDurationSeconds: 0,
      pathWidthMeters: 0,
      centerDistanceKm: center?.distanceKm ?? Number.NaN,
      edgeDistanceKm: edge?.distanceKm ?? Number.NaN,
      centerBearing: center ? initialBearing(selected, center.point) : Number.NaN,
      contacts: [],
      maximum: null,
      localEclipse,
    };
  }

  return {
    type: localType,
    magnitude: localEclipse.getMaxMagnitude(),
    obscuration: localEclipse.getMaxObscuration(),
    moonSunRatio: localEclipse.getMaxMoonSunRatio(),
    durationSeconds: localEclipse.getDuration(),
    centralDurationSeconds: localEclipse.getCentralDuration(),
    pathWidthMeters: localEclipse.getUmbraPathWidth(),
    centerDistanceKm: center?.distanceKm ?? Number.NaN,
    edgeDistanceKm: edge?.distanceKm ?? Number.NaN,
    centerBearing: center ? initialBearing(selected, center.point) : Number.NaN,
    contacts,
    maximum: contacts.find((contact) => contact.key === 'max') ?? null,
    localEclipse,
  };
}

export function shadowOutlineAt(data: EclipseData, date: Date) {
  if (!data.geometry.centralLine.length) return null;
  const path = data.geometry.centralLine;
  let track = shadowTrackCache.get(data);
  if (track === undefined) {
    const points: ShadowTrackPoint[] = [];
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const point of path) {
      try {
        const maximumMs = data.eclipse
          .getLocalEclipse(Location.create(point.lat, point.lon, 0))
          .getContactTimes()
          ?.max?.getDate()
          .getTime();
        if (maximumMs === undefined) continue;
        points.push({ point, maximumMs });
        start = Math.min(start, maximumMs);
        end = Math.max(end, maximumMs);
      } catch {
        // Near-horizon samples can be numerically unstable; other samples remain usable.
      }
    }
    track = points.length && end > start ? { start, end, points } : null;
    shadowTrackCache.set(data, track);
  }
  if (!track || date.getTime() < track.start || date.getTime() > track.end) return null;

  const toi = TimeOfInterest.fromDate(date);
  // The library samples the center line adaptively by geometry, not uniformly by time.
  // Match the requested time against each sample's actual local maximum instead of
  // interpolating an array index from the track endpoints.
  const candidates = track.points
    .map((candidate) => ({
      ...candidate,
      differenceMs: Math.abs(candidate.maximumMs - date.getTime()),
    }))
    .sort((left, right) => left.differenceMs - right.differenceMs)
    .slice(0, 5);
  let best:
    | { magnitude: number; circumstances: LocalEclipseCircumstances }
    | undefined;
  for (const { point } of candidates) {
    try {
      const circumstances = LocalEclipseCircumstances.create(
        data.elements,
        { ...point, elevation: 0 },
        toi,
      );
      const magnitude = circumstances.getMagnitude();
      if (!best || magnitude > best.magnitude) best = { magnitude, circumstances };
    } catch {
      // Try the next time-nearest center-line sample.
    }
  }
  if (!best || !best.circumstances.isInCentralEclipse()) return null;
  return best.circumstances.getUmbraShadowOutline({ refraction: true });
}

export function formatDuration(seconds: number, compact = false) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (compact) return `${minutes}m ${String(secs).padStart(2, '0')}s`;
  return `${minutes} min ${String(secs).padStart(2, '0')} sec`;
}

export function formatDateLabel(date: string, locale = 'en') {
  const { year, month, day } = parseEclipseDate(date);
  const monthName = new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
  }).format(makeUtcDate(2000, month, 1));
  if (year <= 0) return `${day} ${monthName} ${Math.abs(year) + 1} BCE`;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(makeUtcDate(year, month, day));
}

export function formatTime(date: Date, timezone = 'UTC', locale = 'en') {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: timezone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return `${date.toISOString().slice(11, 19)} UTC`;
  }
}

export function formatCoordinate(value: number, latitude: boolean) {
  const absolute = Math.abs(value);
  const suffix = latitude
    ? value >= 0
      ? 'N'
      : 'S'
    : value >= 0
      ? 'E'
      : 'W';
  return `${absolute.toFixed(3)}°${suffix}`;
}

export function toDms(value: number, latitude: boolean) {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  const suffix = latitude
    ? value >= 0
      ? 'N'
      : 'S'
    : value >= 0
      ? 'E'
      : 'W';
  return `${degrees}° ${String(minutes).padStart(2, '0')}′ ${seconds.toFixed(1).padStart(4, '0')}″ ${suffix}`;
}

export function formatAstronomicalYear(year: number) {
  if (year < 0) return `-${String(Math.abs(year)).padStart(4, '0')}`;
  return String(year).padStart(4, '0');
}

export function haversineKm(a: Coordinates, b: Coordinates) {
  const radius = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function nearestCoordinate(origin: Coordinates, path: Coordinates[]) {
  if (!path.length) return { point: origin, distanceKm: 0, index: 0 };
  let index = 0;
  let distanceKm = Number.POSITIVE_INFINITY;
  path.forEach((point, candidateIndex) => {
    const distance = haversineKm(origin, point);
    if (distance < distanceKm) {
      distanceKm = distance;
      index = candidateIndex;
    }
  });
  return { point: path[index], distanceKm, index };
}

export function initialBearing(a: Coordinates, b: Coordinates) {
  const toRad = Math.PI / 180;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

export function destinationPoint(
  start: Coordinates,
  bearingDegrees: number,
  distanceKm: number,
) {
  const angular = distanceKm / 6371.0088;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (start.lat * Math.PI) / 180;
  const lon1 = (start.lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((((lon2 * 180) / Math.PI + 540) % 360) - 180),
  };
}

export function compassDirection(bearing: number) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(bearing / 45) % 8];
}

export function relativeDateLabel(date: string, now = new Date()) {
  const { year, month, day } = parseEclipseDate(date);
  if (year < 100) return '';
  const target = makeUtcDate(year, month, day);
  const days = Math.round((target.getTime() - now.getTime()) / 86_400_000);
  if (Math.abs(days) <= 1) return days === 0 ? 'Today' : days > 0 ? 'Tomorrow' : 'Yesterday';
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(days) < 60) return formatter.format(days, 'day');
  const months = Math.round(days / 30.4375);
  if (Math.abs(months) < 24) return formatter.format(months, 'month');
  return formatter.format(Math.round(months / 12), 'year');
}
