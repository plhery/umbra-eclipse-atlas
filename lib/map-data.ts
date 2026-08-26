import type {
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl';
import type {
  Coordinates,
  EclipseData,
  EclipseKind,
  SelectedLocation,
} from './eclipse';
import { destinationPoint, initialBearing, nearestCoordinate } from './eclipse';
import { Location } from '@astronomy-bundle/core';

type GeoJsonData = Parameters<GeoJSONSource['setData']>[0];

export type LayerVisibility = {
  path: boolean;
  center: boolean;
  partial: boolean;
  horizons: boolean;
  guides: boolean;
  magnitude: boolean;
  timeContours: boolean;
  night: boolean;
  shadow: boolean;
  lightPollution: boolean;
};

export type BaseMap = 'street' | 'terrain' | 'satellite' | 'night';

export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    street: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
    terrain: {
      type: 'raster',
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: '© OpenStreetMap contributors, SRTM | OpenTopoMap',
    },
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
    },
    night: {
      type: 'raster',
      tiles: [
        'https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/Earth_at_Night_2016/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 9,
      attribution: 'NASA Earth Observatory | Esri',
    },
  },
  layers: [
    {
      id: 'base-street',
      type: 'raster',
      source: 'street',
      paint: {
        'raster-saturation': -0.68,
        'raster-contrast': -0.06,
        'raster-brightness-min': 0.08,
        'raster-brightness-max': 0.94,
      },
    },
    {
      id: 'base-terrain',
      type: 'raster',
      source: 'terrain',
      layout: { visibility: 'none' },
      paint: { 'raster-saturation': -0.42, 'raster-contrast': -0.04 },
    },
    {
      id: 'base-satellite',
      type: 'raster',
      source: 'satellite',
      layout: { visibility: 'none' },
    },
    {
      id: 'base-night',
      type: 'raster',
      source: 'night',
      layout: { visibility: 'none' },
    },
  ],
};

const emptyCollection = (): GeoJsonData => ({
  type: 'FeatureCollection',
  features: [],
});

function source(map: MapLibreMap, id: string) {
  return map.getSource(id) as GeoJSONSource | undefined;
}

function addGeoJsonSource(map: MapLibreMap, id: string) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: emptyCollection() });
}

export function installEclipseLayers(map: MapLibreMap) {
  [
    'penumbra',
    'umbra',
    'centerline',
    'horizons',
    'time-guides',
    'magnitude-contours',
    'time-contours',
    'greatest',
    'shadow',
    'night-zones',
    'selected-location',
    'accuracy',
    'comparisons',
    'comparison-lines',
    'profile-line',
  ].forEach((id) => addGeoJsonSource(map, id));

  map.addLayer({
    id: 'penumbra-fill',
    type: 'fill',
    source: 'penumbra',
    paint: { 'fill-color': '#536D74', 'fill-opacity': 0.025 },
  });
  map.addLayer({
    id: 'penumbra-line',
    type: 'line',
    source: 'penumbra',
    paint: {
      'line-color': '#536D74',
      'line-width': 1.2,
      'line-dasharray': [3, 2],
      'line-opacity': 0.72,
    },
  });
  map.addLayer({
    id: 'night-civil',
    type: 'fill',
    source: 'night-zones',
    filter: ['==', ['get', 'zone'], 'civil'],
    paint: { 'fill-color': '#17201d', 'fill-opacity': 0.1 },
  });
  map.addLayer({
    id: 'night-nautical',
    type: 'fill',
    source: 'night-zones',
    filter: ['==', ['get', 'zone'], 'nautical'],
    paint: { 'fill-color': '#17201d', 'fill-opacity': 0.12 },
  });
  map.addLayer({
    id: 'night-astronomical',
    type: 'fill',
    source: 'night-zones',
    filter: ['==', ['get', 'zone'], 'astronomical'],
    paint: { 'fill-color': '#17201d', 'fill-opacity': 0.15 },
  });
  map.addLayer({
    id: 'night-full',
    type: 'fill',
    source: 'night-zones',
    filter: ['==', ['get', 'zone'], 'night'],
    paint: { 'fill-color': '#17201d', 'fill-opacity': 0.18 },
  });
  map.addLayer({
    id: 'comparison-fill',
    type: 'fill',
    source: 'comparisons',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': 0.16,
      'fill-outline-color': ['get', 'color'],
    },
  });
  map.addLayer({
    id: 'umbra-fill',
    type: 'fill',
    source: 'umbra',
    paint: { 'fill-color': '#DB4A35', 'fill-opacity': 0.17 },
  });
  map.addLayer({
    id: 'umbra-limits',
    type: 'line',
    source: 'umbra',
    paint: { 'line-color': '#DB4A35', 'line-width': 1.8 },
  });
  map.addLayer({
    id: 'horizon-lines',
    type: 'line',
    source: 'horizons',
    paint: {
      'line-color': '#536D74',
      'line-width': 1.2,
      'line-dasharray': [2, 2],
      'line-opacity': 0.62,
    },
  });
  map.addLayer({
    id: 'time-guide-lines',
    type: 'line',
    source: 'time-guides',
    paint: {
      'line-color': '#536D74',
      'line-width': 1,
      'line-dasharray': [1, 1.5],
      'line-opacity': 0.58,
    },
  });
  map.addLayer({
    id: 'magnitude-contour-lines',
    type: 'line',
    source: 'magnitude-contours',
    paint: {
      'line-color': '#334E58',
      'line-width': 1.1,
      'line-dasharray': [3, 1.5],
      'line-opacity': 0.82,
    },
  });
  map.addLayer({
    id: 'maximum-time-contour-lines',
    type: 'line',
    source: 'time-contours',
    paint: {
      'line-color': '#536D74',
      'line-width': 1,
      'line-dasharray': [1, 1.5],
      'line-opacity': 0.82,
    },
  });
  map.addLayer({
    id: 'comparison-centerlines',
    type: 'line',
    source: 'comparison-lines',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.5,
      'line-dasharray': [2, 1],
      'line-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'centerline-line',
    type: 'line',
    source: 'centerline',
    paint: { 'line-color': '#A83226', 'line-width': 2.2 },
  });
  map.addLayer({
    id: 'shadow-fill',
    type: 'fill',
    source: 'shadow',
    paint: { 'fill-color': '#102630', 'fill-opacity': 0.46 },
  });
  map.addLayer({
    id: 'shadow-line',
    type: 'line',
    source: 'shadow',
    paint: { 'line-color': '#DB4A35', 'line-width': 2.2 },
  });
  map.addLayer({
    id: 'profile-line-layer',
    type: 'line',
    source: 'profile-line',
    paint: {
      'line-color': '#1F6591',
      'line-width': 2,
      'line-dasharray': [2, 1],
    },
  });
  map.addLayer({
    id: 'accuracy-fill',
    type: 'fill',
    source: 'accuracy',
    paint: {
      'fill-color': '#1F6591',
      'fill-opacity': 0.1,
      'fill-outline-color': '#1F6591',
    },
  });
  map.addLayer({
    id: 'greatest-point',
    type: 'circle',
    source: 'greatest',
    paint: {
      'circle-radius': 5,
      'circle-color': '#F8FBFC',
      'circle-stroke-color': '#102630',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'selected-point-halo',
    type: 'circle',
    source: 'selected-location',
    paint: { 'circle-radius': 11, 'circle-color': '#F8FBFC', 'circle-opacity': 0.88 },
  });
  map.addLayer({
    id: 'selected-point',
    type: 'circle',
    source: 'selected-location',
    paint: {
      'circle-radius': 6,
      'circle-color': '#1F6591',
      'circle-stroke-color': '#F8FBFC',
      'circle-stroke-width': 2,
    },
  });
}

function lineFeature(
  coordinates: Coordinates[],
  properties: Record<string, string | number> = {},
) {
  return {
    type: 'Feature' as const,
    properties,
    geometry: {
      type: 'LineString' as const,
      coordinates: unwrapCoordinates(coordinates).map((point) => [point.lon, point.lat]),
    },
  };
}

function polygonFeature(
  coordinates: Coordinates[],
  properties: Record<string, string | number> = {},
) {
  return {
    type: 'Feature' as const,
    properties,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        unwrapCoordinates(closeRing(coordinates)).map((point) => [point.lon, point.lat]),
      ],
    },
  };
}

export function updateEclipseGeometry(map: MapLibreMap, data: EclipseData) {
  source(map, 'umbra')?.setData({
    type: 'FeatureCollection',
    features: data.geometry.umbra.length ? [polygonFeature(data.geometry.umbra)] : [],
  });
  source(map, 'centerline')?.setData({
    type: 'FeatureCollection',
    features: data.geometry.centralLine.length
      ? [lineFeature(data.geometry.centralLine)]
      : [],
  });
  source(map, 'penumbra')?.setData({
    type: 'FeatureCollection',
    features: data.geometry.penumbra.length
      ? [polygonFeature(data.geometry.penumbra)]
      : [],
  });
  source(map, 'horizons')?.setData({
    type: 'FeatureCollection',
    features: [
      ...(data.geometry.sunrise.length
        ? [lineFeature(data.geometry.sunrise, { color: '#B67A12', kind: 'sunrise' })]
        : []),
      ...(data.geometry.sunset.length
        ? [lineFeature(data.geometry.sunset, { color: '#6E56CF', kind: 'sunset' })]
        : []),
    ],
  });
  const centralLine = data.geometry.centralLine;
  const greatestIndex = nearestCoordinate(data.greatest, centralLine).index;
  const guideHalfLengthKm = Math.max(18, data.pathWidthMeters / 2000);
  source(map, 'time-guides')?.setData({
    type: 'FeatureCollection',
    features: centralLine.flatMap((point, index) => {
      if (Math.abs(index - greatestIndex) % 30 !== 0) return [];
      const before = centralLine[Math.max(0, index - 2)];
      const after = centralLine[Math.min(centralLine.length - 1, index + 2)];
      if (!before || !after || before === after) return [];
      const pathBearing = initialBearing(before, after);
      return [
        lineFeature([
          destinationPoint(point, pathBearing - 90, guideHalfLengthKm),
          destinationPoint(point, pathBearing + 90, guideHalfLengthKm),
        ]),
      ];
    }),
  });
  source(map, 'magnitude-contours')?.setData(emptyCollection());
  source(map, 'time-contours')?.setData(emptyCollection());
  source(map, 'greatest')?.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'greatest' },
        geometry: {
          type: 'Point',
          coordinates: [data.greatest.lon, data.greatest.lat],
        },
      },
    ],
  });
  const pathColor = colorForType(data.type);
  map.setPaintProperty('umbra-fill', 'fill-color', pathColor);
  map.setPaintProperty('umbra-limits', 'line-color', pathColor);
  map.setPaintProperty('centerline-line', 'line-color', pathColor);
  map.setPaintProperty('shadow-line', 'line-color', pathColor);
}

export function updateVisibility(
  map: MapLibreMap,
  visibility: LayerVisibility,
) {
  const set = (id: string, visible: boolean) =>
    map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  set('umbra-fill', visibility.path);
  set('umbra-limits', visibility.path);
  set('centerline-line', visibility.center);
  set('penumbra-fill', visibility.partial);
  set('penumbra-line', visibility.partial);
  set('horizon-lines', visibility.horizons);
  set('time-guide-lines', visibility.guides);
  set('magnitude-contour-lines', visibility.magnitude);
  set('maximum-time-contour-lines', visibility.timeContours);
  set('shadow-fill', visibility.shadow);
  set('shadow-line', visibility.shadow);
  ['night-civil', 'night-nautical', 'night-astronomical', 'night-full'].forEach(
    (id) => set(id, visibility.night),
  );
}

type GridPoint = [number, number];

function contourSegments(
  values: Array<number | null>,
  width: number,
  height: number,
  threshold: number,
  requireFinite: boolean,
  toCoordinate: (x: number, y: number) => GridPoint,
) {
  const segments: GridPoint[][] = [];
  const valueAt = (x: number, y: number) => values[y * width + x];
  const crossing = (
    ax: number,
    ay: number,
    av: number,
    bx: number,
    by: number,
    bv: number,
  ) => {
    const span = bv - av;
    const ratio = span === 0 ? 0.5 : Math.max(0, Math.min(1, (threshold - av) / span));
    return toCoordinate(ax + (bx - ax) * ratio, ay + (by - ay) * ratio);
  };

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const raw = [
        valueAt(x, y),
        valueAt(x + 1, y),
        valueAt(x + 1, y + 1),
        valueAt(x, y + 1),
      ];
      if (requireFinite && raw.some((value) => value === null)) continue;
      const valuesInCell = raw.map((value) => value ?? 0);
      const [topLeft, topRight, bottomRight, bottomLeft] = valuesInCell;
      const hits: GridPoint[] = [];
      if ((topLeft >= threshold) !== (topRight >= threshold)) {
        hits.push(crossing(x, y, topLeft, x + 1, y, topRight));
      }
      if ((topRight >= threshold) !== (bottomRight >= threshold)) {
        hits.push(crossing(x + 1, y, topRight, x + 1, y + 1, bottomRight));
      }
      if ((bottomRight >= threshold) !== (bottomLeft >= threshold)) {
        hits.push(crossing(x + 1, y + 1, bottomRight, x, y + 1, bottomLeft));
      }
      if ((bottomLeft >= threshold) !== (topLeft >= threshold)) {
        hits.push(crossing(x, y + 1, bottomLeft, x, y, topLeft));
      }
      if (hits.length === 2) {
        segments.push(hits);
      } else if (hits.length === 4) {
        const center = (topLeft + topRight + bottomRight + bottomLeft) / 4;
        if (center >= threshold) {
          segments.push([hits[0], hits[3]], [hits[1], hits[2]]);
        } else {
          segments.push([hits[0], hits[1]], [hits[2], hits[3]]);
        }
      }
    }
  }
  return segments;
}

export async function updateScientificContours(
  map: MapLibreMap,
  data: EclipseData,
  shouldApply: () => boolean = () => true,
) {
  const step = 2;
  const north = 84;
  const width = 181;
  const height = 85;
  const magnitudeValues: number[] = [];
  const timeValues: Array<number | null> = [];
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    const lat = north - y * step;
    for (let x = 0; x < width; x += 1) {
      const lon = -180 + x * step;
      try {
        const local = data.eclipse.getLocalEclipse(Location.create(lat, lon, 0));
        if (local.getType() === 'none') {
          magnitudeValues.push(0);
          timeValues.push(null);
          continue;
        }
        magnitudeValues.push(Math.max(0, local.getMaxMagnitude()));
        const maximum = local.getContactTimes()?.max?.getDate().getTime();
        if (!maximum) {
          timeValues.push(null);
          continue;
        }
        const minute = maximum / 60_000;
        minTime = Math.min(minTime, minute);
        maxTime = Math.max(maxTime, minute);
        timeValues.push(minute);
      } catch {
        magnitudeValues.push(0);
        timeValues.push(null);
      }
    }
    if (y % 4 === 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }

  const toCoordinate = (x: number, y: number): GridPoint => [
    -180 + x * step,
    north - y * step,
  ];
  const magnitudeFeatures = [0.2, 0.4, 0.6, 0.8, 1].flatMap((level) => {
    const segments = contourSegments(
      magnitudeValues,
      width,
      height,
      level,
      false,
      toCoordinate,
    );
    return segments.length
      ? [
          {
            type: 'Feature' as const,
            properties: { level, label: level.toFixed(1) },
            geometry: { type: 'MultiLineString' as const, coordinates: segments },
          },
        ]
      : [];
  });
  const firstTime = Math.ceil(minTime / 30) * 30;
  const timeFeatures = Number.isFinite(firstTime)
    ? Array.from(
        { length: Math.max(0, Math.floor((maxTime - firstTime) / 30) + 1) },
        (_, index) => firstTime + index * 30,
      ).flatMap((level) => {
        const segments = contourSegments(
          timeValues,
          width,
          height,
          level,
          true,
          toCoordinate,
        );
        return segments.length
          ? [
              {
                type: 'Feature' as const,
                properties: {
                  level,
                  label: new Date(level * 60_000).toISOString().slice(11, 16) + ' UTC',
                },
                geometry: { type: 'MultiLineString' as const, coordinates: segments },
              },
            ]
          : [];
      })
    : [];

  if (!shouldApply()) return false;
  source(map, 'magnitude-contours')?.setData({
    type: 'FeatureCollection',
    features: magnitudeFeatures,
  });
  source(map, 'time-contours')?.setData({
    type: 'FeatureCollection',
    features: timeFeatures,
  });
  return true;
}

export function updateBaseMap(
  map: MapLibreMap,
  baseMap: BaseMap,
  lightPollution: boolean,
  opacity: number,
) {
  (['street', 'terrain', 'satellite', 'night'] as BaseMap[]).forEach((id) => {
    const visible = id === baseMap || (id === 'night' && lightPollution);
    map.setLayoutProperty(`base-${id}`, 'visibility', visible ? 'visible' : 'none');
  });
  if (lightPollution && baseMap !== 'night') {
    map.setPaintProperty('base-night', 'raster-opacity', opacity);
  } else {
    map.setPaintProperty('base-night', 'raster-opacity', 1);
  }
}

export function updateShadow(map: MapLibreMap, ring: Coordinates[] | null) {
  source(map, 'shadow')?.setData({
    type: 'FeatureCollection',
    features: ring?.length ? [polygonFeature(ring)] : [],
  });
}

export function updateSelectedLocation(
  map: MapLibreMap,
  selected: SelectedLocation | null,
) {
  source(map, 'selected-location')?.setData({
    type: 'FeatureCollection',
    features: selected
      ? [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] },
          },
        ]
      : [],
  });
  const accuracyRing =
    selected?.accuracy && selected.accuracy > 0
      ? geodesicCircle(selected, selected.accuracy / 1000)
      : [];
  source(map, 'accuracy')?.setData({
    type: 'FeatureCollection',
    features: accuracyRing.length ? [polygonFeature(accuracyRing)] : [],
  });
}

export function updateProfileLine(map: MapLibreMap, points: Coordinates[]) {
  source(map, 'profile-line')?.setData({
    type: 'FeatureCollection',
    features: points.length ? [lineFeature(points)] : [],
  });
}

export function updateComparisons(map: MapLibreMap, comparisons: EclipseData[]) {
  source(map, 'comparisons')?.setData({
    type: 'FeatureCollection',
    features: comparisons.flatMap((comparison, index) =>
      comparison.geometry.umbra.length
        ? [
            polygonFeature(comparison.geometry.umbra, {
              date: comparison.date,
              color: comparisonColor(index),
            }),
          ]
        : [],
    ),
  });
  source(map, 'comparison-lines')?.setData({
    type: 'FeatureCollection',
    features: comparisons.flatMap((comparison, index) =>
      comparison.geometry.centralLine.length
        ? [
            lineFeature(comparison.geometry.centralLine, {
              date: comparison.date,
              color: comparisonColor(index),
            }),
          ]
        : [],
    ),
  });
}

export function nightZoneFeatures(date: Date): GeoJsonData {
  const subsolar = getSubsolarPoint(date);
  const antisolar = {
    lat: -subsolar.lat,
    lon: normalizeLongitude(subsolar.lon + 180),
  };
  const zones = [
    ['civil', 90],
    ['nautical', 84],
    ['astronomical', 78],
    ['night', 72],
  ] as const;
  return {
    type: 'FeatureCollection',
    features: zones.map(([zone, radius]) =>
      polygonFeature(geodesicCircle(antisolar, radius * 111.195, 180), { zone }),
    ),
  };
}

export function updateNightZones(map: MapLibreMap, date: Date) {
  source(map, 'night-zones')?.setData(nightZoneFeatures(date));
}

export function fitEclipse(map: MapLibreMap, data: EclipseData, panelWidth = 0) {
  const points = data.geometry.centralLine.length
    ? unwrapCoordinates(data.geometry.centralLine)
    : [data.greatest];
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  points.forEach(({ lat, lon }) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });
  if (![west, east, south, north].every(Number.isFinite)) return;
  map.fitBounds(
    [
      [west, Math.max(-84, south)],
      [east, Math.min(84, north)],
    ],
    {
      padding: { top: 100, right: 70, bottom: 90, left: panelWidth + 50 },
      maxZoom: 5.5,
      duration: 800,
    },
  );
}

export function colorForType(type: EclipseKind) {
  void type;
  return '#DB4A35';
}

export function comparisonColor(index: number) {
  return ['#6E56CF', '#237A57', '#B67A12'][index % 3];
}

export function unwrapCoordinates(points: Coordinates[]) {
  if (!points.length) return [];
  const result = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    let lon = points[index].lon;
    const previous = result[index - 1].lon;
    while (lon - previous > 180) lon -= 360;
    while (lon - previous < -180) lon += 360;
    result.push({ lat: points[index].lat, lon });
  }
  return result;
}

function closeRing(points: Coordinates[]) {
  if (!points.length) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first.lat === last.lat && first.lon === last.lon) return points;
  return [...points, first];
}

function geodesicCircle(center: Coordinates, radiusKm: number, steps = 72) {
  const points: Coordinates[] = [];
  for (let index = 0; index <= steps; index += 1) {
    points.push(destinationPoint(center, (index / steps) * 360, radiusKm));
  }
  return points;
}

function normalizeLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function getSubsolarPoint(date: Date) {
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5;
  const n = julianDay - 2_451_545;
  const meanLongitude = normalizeDegrees(280.46 + 0.9856474 * n);
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * n);
  const anomalyRad = (meanAnomaly * Math.PI) / 180;
  const eclipticLongitude =
    meanLongitude + 1.915 * Math.sin(anomalyRad) + 0.02 * Math.sin(2 * anomalyRad);
  const lambda = (eclipticLongitude * Math.PI) / 180;
  const obliquity = ((23.439 - 0.0000004 * n) * Math.PI) / 180;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(lambda));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(lambda),
    Math.cos(lambda),
  );
  const gmst = normalizeDegrees(
    280.46061837 + 360.98564736629 * (julianDay - 2_451_545),
  );
  return {
    lat: (declination * 180) / Math.PI,
    lon: normalizeLongitude((rightAscension * 180) / Math.PI - gmst),
  };
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}
