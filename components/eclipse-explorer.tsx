'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Accessibility,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileDown,
  Globe2,
  Info,
  Layers3,
  ListFilter,
  LocateFixed,
  MapPin,
  Menu,
  Moon,
  Navigation,
  Pause,
  Play,
  Presentation,
  Route,
  Search,
  Share2,
  Sun,
  X,
} from 'lucide-react';
import tzLookup from 'tz-lookup';
import { trackEvent, trackThrottled, trackDebounced } from '@/lib/analytics';
import type { Map as MapLibreMap } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { TimeOfInterest } from '@astronomy-bundle/core';
import {
  compassDirection,
  computeLocalResult,
  destinationPoint,
  eventRegion,
  findUpcomingEclipsesAtLocation,
  formatCoordinate,
  formatDateLabel,
  formatDuration,
  formatTime,
  getAdjacentEclipseDate,
  getNextSolarEclipseDate,
  loadEclipse,
  parseEclipseDate,
  relativeDateLabel,
  searchCatalogue,
  shadowOutlineAt,
  toDms,
  type CatalogEntry,
  type EclipseData,
  type EclipseKind,
  type LocalResult,
  type SelectedLocation,
  type UpcomingLocalEclipse,
  type UpcomingLocalEclipses,
} from '@/lib/eclipse';
import {
  BASE_STYLE,
  colorForType,
  fitEclipse,
  installEclipseLayers,
  updateBaseMap,
  updateComparisons,
  updateEclipseGeometry,
  updateNightZones,
  updateProfileLine,
  updateScientificContours,
  updateSelectedLocation,
  updateShadow,
  updateVisibility,
  type BaseMap,
  type LayerVisibility,
} from '@/lib/map-data';
import {
  fetchElevation,
  fetchHorizonProfile,
  reverseGeocode,
  searchPlaces,
  type HorizonProfile,
  type PlaceResult,
} from '@/lib/services';

const DEFAULT_DATE = getNextSolarEclipseDate() ?? '2027-02-06';
const DEFAULT_LAYERS: LayerVisibility = {
  path: true,
  center: true,
  partial: true,
  horizons: false,
  guides: false,
  magnitude: false,
  timeContours: false,
  night: false,
  shadow: true,
  lightPollution: false,
};
type LayerPreset = 'simple' | 'plan' | 'explain' | 'analyze';
const LAYER_PRESETS: Record<LayerPreset, LayerVisibility> = {
  simple: { ...DEFAULT_LAYERS },
  plan: {
    ...DEFAULT_LAYERS,
    horizons: true,
    guides: true,
  },
  explain: {
    ...DEFAULT_LAYERS,
    guides: true,
    night: true,
  },
  analyze: {
    ...DEFAULT_LAYERS,
    horizons: true,
    guides: true,
    magnitude: true,
    timeContours: true,
    shadow: false,
  },
};
const LAYER_PRESET_LABELS: Array<{
  id: LayerPreset;
  label: string;
  detail: string;
}> = [
  { id: 'simple', label: 'Simple', detail: 'Path and moving shadow' },
  { id: 'plan', label: 'Plan', detail: 'Horizons and time ticks' },
  { id: 'explain', label: 'Explain', detail: 'Shadow, daylight and timing' },
  { id: 'analyze', label: 'Analyze', detail: 'Contours and geometry' },
];
const ALL_TYPES: EclipseKind[] = ['total', 'annular', 'hybrid', 'partial'];
const TYPE_LABELS: Record<EclipseKind, string> = {
  total: 'Total',
  annular: 'Annular',
  hybrid: 'Hybrid',
  partial: 'Partial',
};
const BASE_LABELS: Array<{ id: BaseMap; label: string; detail: string }> = [
  { id: 'street', label: 'Map', detail: 'Roads & places' },
  { id: 'terrain', label: 'Terrain', detail: 'Relief & peaks' },
  { id: 'satellite', label: 'Satellite', detail: 'World imagery' },
  { id: 'night', label: 'Night', detail: 'Earth at night' },
];

type Drawer = 'catalog' | 'search' | 'layers' | 'more' | null;
type SheetSnap = 'peek' | 'mid' | 'full';
type TimeMode = 'local' | 'utc';
type DistanceUnit = 'metric' | 'imperial';
type TimelineIntent = 'auto' | 'manual' | 'now';
type LocationComparisonItem = {
  key: string;
  place: SelectedLocation;
  result: LocalResult;
  zone: string;
};

function getInitialUrlState() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const numberParam = (key: string, min: number, max: number) => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : null;
  };
  const lat = numberParam('lat', -90, 90);
  const lon = numberParam(params.has('lon') ? 'lon' : 'lng', -180, 180);
  const mapLat = numberParam('mapLat', -85, 85);
  const mapLon = numberParam('mapLon', -180, 180);
  const zoom = numberParam('z', 1.2, 18);
  const elevation = numberParam('elv', -500, 9000);
  const time = params.get('t');
  const requestedTimezone = params.get('tz');
  let timezoneOverride = '';
  if (requestedTimezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: requestedTimezone }).format();
      timezoneOverride = requestedTimezone;
    } catch {
      timezoneOverride = '';
    }
  }
  const selected =
    lat !== null && lon !== null
      ? ({ lat, lon, elevation: elevation ?? 0, name: 'Shared location' } satisfies SelectedLocation)
      : null;
  const center =
    mapLat !== null && mapLon !== null
      ? ([mapLon, mapLat] as [number, number])
      : selected
        ? ([selected.lon, selected.lat] as [number, number])
        : ([0, 15] as [number, number]);
  const activeLayerNames = new Set(
    params.has('layers') ? (params.get('layers') || '').split(',').filter(Boolean) : [],
  );
  const layerState = { ...DEFAULT_LAYERS };
  if (params.has('layers')) {
    (Object.keys(layerState) as Array<keyof LayerVisibility>).forEach((key) => {
      layerState[key] = activeLayerNames.has(key);
    });
  }
  return {
    event: params.get('e') || DEFAULT_DATE,
    selected,
    hasElevation: elevation !== null,
    zoom: zoom ?? (selected ? 6 : 2),
    center,
    hasMapView: !!selected || (mapLat !== null && mapLon !== null),
    base: (params.get('style') as BaseMap | null) || 'street',
    layers: layerState,
    nightOpacity: numberParam('nightOpacity', 0.15, 0.95) ?? 0.62,
    timezoneOverride,
    time: time && !Number.isNaN(Date.parse(time)) ? new Date(time).getTime() : null,
    presentation: params.get('present') === '1',
  };
}

function percent(value: number, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return (value * 100).toFixed(digits) + '%';
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function icsDate(date: Date) {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, '');
}

function icsEscape(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function downloadText(filename: string, type: string, value: string) {
  downloadBlob(filename, new Blob([value], { type }));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function distanceLabel(km: number, unit: DistanceUnit) {
  if (!Number.isFinite(km)) return '—';
  if (unit === 'imperial') return (km * 0.621371).toFixed(km < 16 ? 1 : 0) + ' mi';
  return km.toFixed(km < 10 ? 1 : 0) + ' km';
}

function locationKey(place: Pick<SelectedLocation, 'lat' | 'lon'>) {
  return place.lat.toFixed(5) + ':' + place.lon.toFixed(5);
}

function observability(local: LocalResult | null) {
  if (!local || local.type === 'none') return 'outside' as const;
  if ((local.maximum?.altitude ?? -90) > -0.8) return 'visible' as const;
  if (
    local.contacts.some(
      (contact) => contact.key.startsWith('c') && contact.altitude > -0.8,
    )
  ) {
    return 'partial' as const;
  }
  return 'below' as const;
}

function typeSentence(type: string, horizon: ReturnType<typeof observability> = 'visible') {
  if (horizon === 'below') return 'Eclipse stays below the horizon here';
  if (horizon === 'partial') return 'Part of the eclipse is above the horizon';
  if (type === 'total') return 'Total eclipse at this location';
  if (type === 'annular') return 'Annular eclipse at this location';
  if (type === 'partial') return 'Partial eclipse at this location';
  return 'Not visible at this location';
}

function typeDetail(type: string, horizon: ReturnType<typeof observability> = 'visible') {
  if (horizon === 'below') return 'The Sun is below the horizon throughout the local eclipse.';
  if (horizon === 'partial') return 'Sunrise or sunset cuts through the local eclipse.';
  if (type === 'total') return 'The Sun is fully covered between C2 and C3.';
  if (type === 'annular') return 'A bright ring remains between C2 and C3.';
  if (type === 'partial') return 'The Moon covers part of the Sun.';
  return 'Try another point inside the shaded visibility area.';
}

function safetySentence(type: string, horizon: ReturnType<typeof observability>) {
  if (horizon === 'below' || type === 'none') {
    return 'Never look at the bright Sun without certified eclipse glasses.';
  }
  if (type === 'total') {
    return 'Glasses may come off only during totality, between C2 and C3. Put them back on as totality ends.';
  }
  return 'Keep certified eclipse glasses on throughout the eclipse.';
}

function compareEclipseDates(a: string, b: string) {
  const left = parseEclipseDate(a);
  const right = parseEclipseDate(b);
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

export default function EclipseExplorer() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const eventPanelRef = useRef<HTMLElement>(null);
  const eventPanelScrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousDrawerRef = useRef<Drawer>(null);
  const presentationLayersRef = useRef<LayerVisibility | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const choosePointRef = useRef<
    (lat: number, lon: number, name?: string, accuracy?: number, elevation?: number, source?: string) => void
  >(() => undefined);
  const urlStateRef = useRef<ReturnType<typeof getInitialUrlState>>(null);
  const initialMapViewHandledRef = useRef(false);
  const contourDateRef = useRef<string | null>(null);
  const lastCursorUpdateRef = useRef(0);
  const playbackTimeRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const sheetDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    moved: boolean;
  } | null>(null);
  const sheetDragCleanupRef = useRef<(() => void) | null>(null);
  const lastSheetDragAtRef = useRef(0);

  const [eventDate, setEventDate] = useState(DEFAULT_DATE);
  const [data, setData] = useState<EclipseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<SelectedLocation | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('peek');
  const [sheetDragHeight, setSheetDragHeight] = useState<number | null>(null);
  const [baseMap, setBaseMap] = useState<BaseMap>('street');
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [nightOpacity, setNightOpacity] = useState(0.62);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [timelineIntent, setTimelineIntent] = useState<TimelineIntent>('auto');
  const [timeMode, setTimeMode] = useState<TimeMode>('local');
  const [timezoneOverride, setTimezoneOverride] = useState('');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('metric');
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [contourReadout, setContourReadout] = useState<{
    label: string;
    kind: 'Magnitude' | 'Maximum time';
    x: number;
    y: number;
  } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number; zoom: number }>({
    lat: 15,
    lon: 0,
    zoom: 2,
  });
  const [tracking, setTracking] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [elevationStatus, setElevationStatus] = useState<
    'loading' | 'measured' | 'provided' | 'unavailable'
  >('provided');
  const [toast, setToast] = useState('');
  const [savedPlaces, setSavedPlaces] = useState<SelectedLocation[]>([]);
  const [profile, setProfile] = useState<HorizonProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [upcomingLookup, setUpcomingLookup] = useState<{
    key: string;
    results: UpcomingLocalEclipses | null;
    error: string;
  }>({ key: '', results: null, error: '' });
  const [comparisonDates, setComparisonDates] = useState<string[]>([]);
  const [presentationMode, setPresentationMode] = useState(false);

  useEffect(() => {
    playbackTimeRef.current = timeMs;
  }, [timeMs]);

  useEffect(() => () => sheetDragCleanupRef.current?.(), []);

  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState('');

  const currentYear = new Date().getUTCFullYear();
  const [fromYear, setFromYear] = useState(currentYear);
  const [toYear, setToYear] = useState(currentYear + 20);
  const [typeFilters, setTypeFilters] = useState<EclipseKind[]>(ALL_TYPES);
  const [minDuration, setMinDuration] = useState(0);
  const [sarosFilter, setSarosFilter] = useState('');
  const [catalogSort, setCatalogSort] = useState<'date' | 'duration' | 'magnitude'>('date');
  const [visibleHere, setVisibleHere] = useState(false);
  const [centralOnly, setCentralOnly] = useState(false);
  const [catalogResults, setCatalogResults] = useState<CatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogProgress, setCatalogProgress] = useState(0);
  const [catalogError, setCatalogError] = useState('');
  const [catalogSearched, setCatalogSearched] = useState(false);

  const timezone = useMemo(() => {
    if (!selected) return 'UTC';
    try {
      return tzLookup(selected.lat, selected.lon);
    } catch {
      return 'UTC';
    }
  }, [selected]);
  const supportedTimezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [timezone];
    }
  }, [timezone]);

  const local = useMemo(() => {
    if (!data || !selected) return null;
    try {
      return computeLocalResult(data, selected);
    } catch {
      return null;
    }
  }, [data, selected]);

  const selectedLat = selected?.lat;
  const selectedLon = selected?.lon;
  const selectedElevation = selected?.elevation;
  const upcomingRequestKey =
    selectedLat === undefined || selectedLon === undefined || selectedElevation === undefined
      ? ''
      : `${eventDate}|${selectedLat.toFixed(6)}|${selectedLon.toFixed(6)}|${Math.round(selectedElevation)}`;
  const upcomingIsCurrent = upcomingLookup.key === upcomingRequestKey;
  const upcomingEclipses = upcomingIsCurrent ? upcomingLookup.results : null;
  const upcomingError = upcomingIsCurrent ? upcomingLookup.error : '';
  const upcomingLoading = Boolean(selected) &&
    (elevationStatus === 'loading' || !upcomingIsCurrent);

  useEffect(() => {
    if (
      selectedLat === undefined ||
      selectedLon === undefined ||
      selectedElevation === undefined ||
      elevationStatus === 'loading'
    ) return;

    let active = true;
    const requestKey = upcomingRequestKey;
    const timeout = window.setTimeout(() => {
      findUpcomingEclipsesAtLocation(
        { lat: selectedLat, lon: selectedLon, elevation: selectedElevation },
        eventDate,
      )
        .then((results) => {
          if (active) setUpcomingLookup({ key: requestKey, results, error: '' });
        })
        .catch(() => {
          if (active) {
            trackThrottled('service_error', { service: 'upcoming_eclipses' });
            setUpcomingLookup({
              key: requestKey,
              results: null,
              error: 'Future eclipses could not be calculated.',
            });
          }
        });
    }, 240);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    eventDate,
    elevationStatus,
    selectedElevation,
    selectedLat,
    selectedLon,
    upcomingRequestKey,
  ]);

  const localObservability = observability(local);
  const horizonAzimuth = local?.maximum?.azimuth;
  const horizonAltitude = local?.maximum?.altitude;
  const maximumViewLine = useMemo(() => {
    if (!selected || !local?.maximum) return [];
    return [
      { lat: selected.lat, lon: selected.lon },
      destinationPoint(selected, local.maximum.azimuth, 80),
    ];
  }, [selected, local]);
  const locationComparisons = useMemo<LocationComparisonItem[]>(() => {
    if (!data) return [];
    const places = [...(selected ? [selected] : []), ...savedPlaces]
      .filter(
        (place, index, items) =>
          items.findIndex((candidate) => locationKey(candidate) === locationKey(place)) === index,
      )
      .slice(0, 8);
    return places.flatMap((place) => {
      try {
        return [
          {
            key: locationKey(place),
            place,
            result: computeLocalResult(data, place),
            zone: (() => {
              try {
                return tzLookup(place.lat, place.lon);
              } catch {
                return 'UTC';
              }
            })(),
          },
        ];
      } catch {
        return [];
      }
    });
  }, [data, selected, savedPlaces]);
  const bestComparisonKey = useMemo(() => {
    const visible = locationComparisons.filter((item) => item.result.type !== 'none');
    return visible.sort(
      (left, right) =>
        right.result.obscuration - left.result.obscuration ||
        (right.result.maximum?.altitude ?? -90) - (left.result.maximum?.altitude ?? -90),
    )[0]?.key;
  }, [locationComparisons]);
  const liveCircumstances = useMemo(() => {
    if (!local?.localEclipse || !timeMs) return null;
    try {
      const circumstances = local.localEclipse.getCircumstances(
        TimeOfInterest.fromDate(new Date(timeMs)),
      );
      const horizontal = circumstances.getApparentTopocentricHorizontalCoordinates();
      return {
        magnitude: Math.max(0, circumstances.getMagnitude()),
        obscuration: Math.max(0, circumstances.getObscuration()),
        altitude: horizontal.altitude,
        azimuth: horizontal.azimuth,
      };
    } catch {
      return null;
    }
  }, [local, timeMs]);

  const displayZone =
    timeMode === 'local' && selected ? timezoneOverride || timezone : 'UTC';
  const mapSummary = useMemo(() => {
    if (!data) return 'The eclipse map is loading.';
    const summary = [
      TYPE_LABELS[data.type] + ' solar eclipse on ' + formatDateLabel(data.date) + '.',
      'The mapped route is ' + eventRegion(data.date, data.greatest) + '.',
      'Greatest eclipse is near ' +
        formatCoordinate(data.greatest.lat, true) +
        ', ' +
        formatCoordinate(data.greatest.lon, false) +
        ' at ' +
        formatTime(data.greatestTime, 'UTC') + '.',
    ];
    if (selected && local) {
      summary.push(typeSentence(local.type, localObservability) + '.');
      if (local.type !== 'none' && local.maximum) {
        summary.push(
          percent(local.obscuration) +
            ' of the Sun is covered, with maximum at ' +
            formatTime(local.maximum.date, displayZone) +
            '.',
        );
      }
    } else {
      summary.push('Choose a location to calculate local visibility and times.');
    }
    return summary.join(' ');
  }, [data, selected, local, localObservability, displayZone]);
  const timelineBounds = useMemo(() => {
    if (!data) return { start: 0, end: 1 };
    const eclipseContacts = local?.contacts.filter((contact) => contact.key.startsWith('c'));
    const start = eclipseContacts?.[0]?.date.getTime() ?? data.rangeStart.getTime();
    const end = eclipseContacts?.[eclipseContacts.length - 1]?.date.getTime() ?? data.rangeEnd.getTime();
    return { start, end: Math.max(start + 1, end) };
  }, [data, local]);
  const timelineProgress = Math.max(
    0,
    Math.min(1, (timeMs - timelineBounds.start) / (timelineBounds.end - timelineBounds.start)),
  );
  const maximumTimelinePercent = Math.max(
    0,
    Math.min(
      100,
      (((local?.maximum?.date.getTime() ?? data?.greatestTime.getTime() ?? timelineBounds.start) -
        timelineBounds.start) /
        (timelineBounds.end - timelineBounds.start)) *
        100,
    ),
  );
  const nowAvailable = Date.now() >= timelineBounds.start && Date.now() <= timelineBounds.end;
  const timelineStatus = playing
    ? 'Playing'
    : timelineIntent === 'now'
      ? 'Now'
      : Math.abs(timeMs - (local?.maximum?.date.getTime() ?? data?.greatestTime.getTime() ?? 0)) < 30_000
        ? 'Maximum'
        : 'Viewing';

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  }, []);

  useEffect(() => {
    if (
      selectedLat === undefined ||
      selectedLon === undefined ||
      selectedElevation === undefined ||
      horizonAzimuth === undefined ||
      horizonAltitude === undefined ||
      elevationStatus === 'loading' ||
      data?.date !== eventDate ||
      local?.type === 'none' ||
      localObservability === 'below'
    ) return;

    let active = true;
    const timeout = window.setTimeout(() => {
      setProfileLoading(true);
      fetchHorizonProfile(
        { lat: selectedLat, lon: selectedLon, elevation: selectedElevation },
        horizonAzimuth,
        horizonAltitude,
      )
        .then((result) => {
          if (active) setProfile(result);
        })
        .catch(() => {
          if (active) {
            trackThrottled('service_error', { service: 'terrain' });
            showToast('Terrain skyline is temporarily unavailable');
          }
        })
        .finally(() => {
          if (active) setProfileLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    data?.date,
    elevationStatus,
    eventDate,
    horizonAltitude,
    horizonAzimuth,
    local?.type,
    localObservability,
    selectedElevation,
    selectedLat,
    selectedLon,
    showToast,
  ]);

  const choosePoint = useCallback(
    (
      lat: number,
      lon: number,
      name = 'Selected point',
      accuracy?: number,
      elevation?: number,
      source = 'map',
    ) => {
      trackEvent('location_select', { source });
      const requestId = ++selectionRequestRef.current;
      const provisional: SelectedLocation = {
        lat: Math.max(-90, Math.min(90, lat)),
        lon: ((((lon + 180) % 360) + 360) % 360) - 180,
        elevation: elevation ?? 0,
        name,
        accuracy,
      };
      setSelected(provisional);
      setTimezoneOverride('');
      setProfile(null);
      setProfileLoading(false);
      setElevationStatus(elevation === undefined ? 'loading' : 'provided');
      setSheetSnap('peek');
      eventPanelScrollRef.current?.scrollTo({ top: 0 });

      Promise.allSettled([
        name === 'Selected point' || name === 'Shared location'
          ? reverseGeocode(provisional.lat, provisional.lon)
          : Promise.resolve(name),
        elevation === undefined
          ? fetchElevation(provisional.lat, provisional.lon)
          : Promise.resolve(elevation),
      ]).then(([resolvedName, resolvedElevation]) => {
        if (selectionRequestRef.current !== requestId) return;
        if (resolvedName.status === 'rejected') trackThrottled('service_error', { service: 'reverse_geocode' });
        if (resolvedElevation.status === 'rejected') trackThrottled('service_error', { service: 'elevation' });
        if (elevation === undefined) {
          setElevationStatus(resolvedElevation.status === 'fulfilled' ? 'measured' : 'unavailable');
        }
        const resolvedPlace: SelectedLocation = {
          ...provisional,
          name: resolvedName.status === 'fulfilled' ? resolvedName.value : provisional.name,
          elevation:
            resolvedElevation.status === 'fulfilled'
              ? Math.round(resolvedElevation.value)
              : provisional.elevation,
        };
        setSelected((current) => {
          if (!current || current.lat !== provisional.lat || current.lon !== provisional.lon) return current;
          return { ...current, name: resolvedPlace.name, elevation: resolvedPlace.elevation };
        });
        setSavedPlaces((current) => {
          const index = current.findIndex((place) => locationKey(place) === locationKey(provisional));
          if (index < 0) return current;
          const next = [...current];
          next[index] = { ...next[index], name: resolvedPlace.name, elevation: resolvedPlace.elevation };
          localStorage.setItem('umbra-saved-places', JSON.stringify(next));
          return next;
        });
      });
    },
    [],
  );

  const focusSelectedLocation = useCallback((location: { lat: number; lon: number }) => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;

    const mapRect = container.getBoundingClientRect();
    const panelRect = eventPanelRef.current?.getBoundingClientRect();
    const timelineRect = document.querySelector<HTMLElement>('.timeline-dock')?.getBoundingClientRect();
    const mobile = window.innerWidth <= 760;
    let visibleLeft = mapRect.left;
    const visibleRight = mapRect.right;
    const visibleTop = Math.max(mapRect.top, mobile ? 60 : 62);
    let visibleBottom = mapRect.bottom;

    if (mobile) {
      if (panelRect) visibleBottom = Math.min(visibleBottom, panelRect.top);
      if (timelineRect?.width && timelineRect.height) {
        visibleBottom = Math.min(visibleBottom, timelineRect.top - 8);
      }
    } else if (panelRect) {
      visibleLeft = Math.max(visibleLeft, panelRect.right);
      if (timelineRect?.width && timelineRect.height) {
        visibleBottom = Math.min(visibleBottom, timelineRect.top);
      }
    }

    const targetX = (visibleLeft + visibleRight) / 2 - mapRect.left;
    const targetY = (visibleTop + Math.max(visibleTop + 80, visibleBottom)) / 2 - mapRect.top;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.easeTo({
      center: [location.lon, location.lat],
      zoom: Math.max(map.getZoom(), 6),
      offset: [targetX - mapRect.width / 2, targetY - mapRect.height / 2],
      duration: reducedMotion ? 0 : 620,
    });
  }, []);

  useEffect(() => {
    if (
      !mapReady ||
      sheetSnap === 'full' ||
      selectedLat === undefined ||
      selectedLon === undefined
    ) return;
    const timeout = window.setTimeout(
      () => focusSelectedLocation({ lat: selectedLat, lon: selectedLon }),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [mapReady, selectedLat, selectedLon, sheetSnap, focusSelectedLocation]);

  useEffect(() => {
    choosePointRef.current = choosePoint;
  }, [choosePoint]);

  useEffect(() => {
    urlStateRef.current = getInitialUrlState();
    const initial = urlStateRef.current;
    if (!initial) return;
    if (/^-?\d+-\d{2}-\d{2}$/.test(initial.event)) setEventDate(initial.event);
    setBaseMap(BASE_LABELS.some((item) => item.id === initial.base) ? initial.base : 'street');
    setLayers(initial.layers);
    setNightOpacity(initial.nightOpacity);
    setTimezoneOverride(initial.timezoneOverride);
    setPresentationMode(initial.presentation);
    setMapCenter({ lat: initial.center[1], lon: initial.center[0], zoom: initial.zoom });
    if (initial.selected) {
      choosePoint(
        initial.selected.lat,
        initial.selected.lon,
        initial.selected.name,
        undefined,
        initial.hasElevation ? initial.selected.elevation : undefined,
        'shared_link',
      );
      setTimezoneOverride(initial.timezoneOverride);
    }
    if (initial.time) {
      setTimeMs(initial.time);
      setTimelineIntent('manual');
    }
    try {
      const stored = JSON.parse(localStorage.getItem('umbra-saved-places') || '[]') as SelectedLocation[];
      setSavedPlaces(Array.isArray(stored) ? stored.slice(0, 12) : []);
    } catch {
      setSavedPlaces([]);
    }
  }, [choosePoint]);

  useEffect(() => {
    const previous = previousDrawerRef.current;
    if (previous !== drawer) {
      if (previous) trackEvent('panel_close', { panel: previous });
      if (drawer) trackEvent('panel_view', { panel: drawer });
    }
    if (drawer && !previous) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) drawerReturnFocusRef.current = active;
      window.requestAnimationFrame(() => {
        const target =
          drawer === 'search'
            ? drawerRef.current?.querySelector<HTMLElement>('input')
            : drawerRef.current?.querySelector<HTMLElement>('[data-drawer-heading]');
        target?.focus();
      });
    } else if (!drawer && previous) {
      window.requestAnimationFrame(() => drawerReturnFocusRef.current?.focus());
    }
    previousDrawerRef.current = drawer;
  }, [drawer]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let disposed = false;
    import('maplibre-gl').then((maplibregl) => {
      if (disposed || !mapContainerRef.current) return;
      maplibregl.setWorkerUrl(mapLibreWorkerUrl);
      const initial = urlStateRef.current ?? getInitialUrlState();
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: BASE_STYLE,
        center: initial?.center ?? [0, 15],
        zoom: initial?.zoom ?? 2,
        minZoom: 1.2,
        maxZoom: 18,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      mapRef.current = map;
      map.on('error', () => trackThrottled('service_error', { service: 'map' }, 30_000));
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');
      map.addControl(new maplibregl.FullscreenControl(), 'bottom-right');
      map.on('load', () => {
        trackEvent('map_ready', { duration_ms: Math.round(performance.now()) });
        installEclipseLayers(map);
        const showContour = (kind: 'Magnitude' | 'Maximum time') =>
          (event: import('maplibre-gl').MapLayerMouseEvent) => {
            const label = event.features?.[0]?.properties?.label;
            if (!label) return;
            map.getCanvas().style.cursor = 'help';
            setContourReadout({ label: String(label), kind, x: event.point.x, y: event.point.y });
          };
        map.on('mousemove', 'magnitude-contour-lines', showContour('Magnitude'));
        map.on('mousemove', 'maximum-time-contour-lines', showContour('Maximum time'));
        map.on('mouseleave', 'magnitude-contour-lines', () => {
          map.getCanvas().style.cursor = 'crosshair';
          setContourReadout(null);
        });
        map.on('mouseleave', 'maximum-time-contour-lines', () => {
          map.getCanvas().style.cursor = 'crosshair';
          setContourReadout(null);
        });
        setMapReady(true);
      });
      map.on('click', (event) => {
        choosePointRef.current(event.lngLat.lat, event.lngLat.lng);
      });
      map.on('contextmenu', (event) => {
        trackThrottled('map_move', { action: 'context_zoom', zoom: Math.round(map.getZoom()) });
        map.easeTo({
          center: event.lngLat,
          zoom: Math.min(12, map.getZoom() + 2),
          duration: 450,
        });
      });
      map.on('mousemove', (event) => {
        const now = performance.now();
        if (now - lastCursorUpdateRef.current < 80) return;
        lastCursorUpdateRef.current = now;
        setCursor({ lat: event.lngLat.lat, lon: event.lngLat.lng });
      });
      map.on('mouseout', () => setCursor(null));
      map.on('moveend', (event) => {
        if (event.originalEvent) trackThrottled('map_move', { action: 'pan_zoom', zoom: Math.round(map.getZoom()) });
        const center = map.getCenter();
        setMapCenter({ lat: center.lat, lon: center.lng, zoom: map.getZoom() });
      });
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();
    loadEclipse(eventDate)
      .then((loaded) => {
        if (!active) return;
        trackEvent('eclipse_loaded', { eclipse: loaded.date, kind: loaded.type, duration_ms: Math.round(performance.now() - startedAt) });
        setData(loaded);
        setTimeMs((current) =>
          current && current >= loaded.rangeStart.getTime() && current <= loaded.rangeEnd.getTime()
            ? current
            : loaded.greatestTime.getTime(),
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        trackEvent('service_error', { service: 'eclipse' });
        setLoadError(error instanceof Error ? error.message : 'This eclipse could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventDate]);

  useEffect(() => {
    if (!mapReady || !data || !mapRef.current) return;
    updateEclipseGeometry(mapRef.current, data);
    if (!initialMapViewHandledRef.current) {
      initialMapViewHandledRef.current = true;
      if (!urlStateRef.current?.hasMapView) {
        fitEclipse(mapRef.current, data, window.innerWidth > 760 ? 410 : 0);
      }
    } else {
      fitEclipse(mapRef.current, data, window.innerWidth > 760 ? 410 : 0);
    }
  }, [mapReady, data]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    updateVisibility(mapRef.current, layers);
    updateBaseMap(mapRef.current, baseMap, layers.lightPollution, nightOpacity);
  }, [mapReady, layers, baseMap, nightOpacity]);

  useEffect(() => {
    if (
      !mapReady ||
      !mapRef.current ||
      !data ||
      (!layers.magnitude && !layers.timeContours) ||
      contourDateRef.current === data.date
    ) {
      return;
    }
    const map = mapRef.current;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      updateScientificContours(
        map,
        data,
        () => !cancelled && mapRef.current === map,
      ).then((applied) => {
        if (applied && !cancelled) contourDateRef.current = data.date;
      });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [mapReady, data, layers.magnitude, layers.timeContours]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    updateSelectedLocation(mapRef.current, selected);
  }, [mapReady, selected]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !data || !timeMs) return;
    const map = mapRef.current;
    const date = new Date(timeMs);
    try {
      if (layers.night) updateNightZones(map, date);
      updateShadow(map, layers.shadow ? shadowOutlineAt(data, date) : null);
    } catch {
      updateShadow(map, null);
    }
  }, [mapReady, data, timeMs, layers.night, layers.shadow]);

  const localMaximumMs = local?.maximum?.date.getTime() ?? null;

  useEffect(() => {
    if (timelineIntent !== 'auto') return;
    const now = Date.now();
    if (now >= timelineBounds.start && now <= timelineBounds.end) {
      const timeout = window.setTimeout(() => {
        setTimelineIntent('now');
        setTimeMs(now);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (!localMaximumMs) return;
    const timeout = window.setTimeout(() => setTimeMs(localMaximumMs), 0);
    return () => window.clearTimeout(timeout);
  }, [localMaximumMs, timelineIntent, timelineBounds.start, timelineBounds.end]);

  useEffect(() => {
    if (timelineIntent !== 'now' || playing) return;
    const syncNow = () => {
      if (document.visibilityState === 'visible') {
        setTimeMs(Math.max(timelineBounds.start, Math.min(timelineBounds.end, Date.now())));
      }
    };
    syncNow();
    const interval = window.setInterval(syncNow, 1_000);
    document.addEventListener('visibilitychange', syncNow);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', syncNow);
    };
  }, [timelineIntent, playing, timelineBounds.start, timelineBounds.end]);

  useEffect(() => {
    if (!playing || !data) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      if (now - previous < 100) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const elapsed = now - previous;
      previous = now;
      const speed = (timelineBounds.end - timelineBounds.start) / 22_000;
      const current = Math.max(timelineBounds.start, playbackTimeRef.current);
      const next = Math.min(timelineBounds.end, current + elapsed * speed);
      playbackTimeRef.current = next;
      setTimeMs(next);
      if (next >= timelineBounds.end) {
        trackEvent('timeline_playback', { action: 'complete' });
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, data, timelineBounds.end, timelineBounds.start]);

  useEffect(() => {
    let active = true;
    if (!mapReady || !mapRef.current) return;
    if (!comparisonDates.length) {
      updateComparisons(mapRef.current, []);
      return;
    }
    Promise.all(comparisonDates.filter((date) => date !== eventDate).map(loadEclipse)).then((items) => {
      if (active && mapRef.current) updateComparisons(mapRef.current, items);
    });
    return () => {
      active = false;
    };
  }, [mapReady, comparisonDates, eventDate]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    updateProfileLine(mapRef.current, maximumViewLine);
  }, [mapReady, maximumViewLine]);

  const togglePlayback = useCallback(() => {
    trackEvent('timeline_playback', { action: playing ? 'pause' : 'play' });
    if (playing) {
      setPlaying(false);
      setTimelineIntent('manual');
      return;
    }
    const start =
      playbackTimeRef.current >= timelineBounds.end
        ? timelineBounds.start
        : Math.max(timelineBounds.start, playbackTimeRef.current);
    playbackTimeRef.current = start;
    setTimeMs(start);
    setTimelineIntent('manual');
    setPlaying(true);
  }, [playing, timelineBounds.end, timelineBounds.start]);

  const startLocationTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      trackEvent('location_result', { status: 'unsupported' });
      const message = 'Location is not available in this browser. Search for a place instead.';
      setLocationError(message);
      showToast(message);
      return;
    }
    if (tracking) return;
    trackEvent('location_request');
    setTimezoneOverride('');
    setLocationError('');
    setTracking(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy, altitude } = position.coords;
        trackEvent('location_result', { status: 'success' });
        choosePoint(latitude, longitude, 'My location', accuracy, altitude ?? undefined, 'geolocation');
        setTracking(false);
      },
      (error) => {
        trackEvent('location_result', { status: error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable' });
        setTracking(false);
        const message = 'Location access was not available. Search for a place or try again.';
        setLocationError(message);
        showToast(message);
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
    );
  }, [tracking, choosePoint, showToast]);

  const enterPresentation = useCallback(() => {
    trackEvent('presentation', { enabled: true });
    presentationLayersRef.current = layers;
    setLayers({ ...LAYER_PRESETS.explain });
    setDrawer(null);
    setPresentationMode(true);
    setSheetSnap('peek');
    window.requestAnimationFrame(() => {
      if (data && mapRef.current) fitEclipse(mapRef.current, data, 0);
    });
  }, [data, layers]);

  const exitPresentation = useCallback(() => {
    trackEvent('presentation', { enabled: false });
    if (presentationLayersRef.current) {
      setLayers(presentationLayersRef.current);
      presentationLayersRef.current = null;
    }
    setPresentationMode(false);
    window.requestAnimationFrame(() => {
      if (data && mapRef.current) {
        fitEclipse(mapRef.current, data, window.innerWidth > 760 ? 410 : 0);
      }
      drawerReturnFocusRef.current?.focus();
    });
  }, [data]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        if (drawer) setDrawer(null);
        else if (presentationMode) exitPresentation();
        return;
      }
      if (event.key === 'Tab' && drawer && drawerRef.current) {
        const focusable = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDrawer('search');
        return;
      }
      const interactive = target?.closest(
        'button, a, input, select, textarea, summary, [contenteditable="true"], [role]:not([role="region"])',
      );
      if (interactive) return;
      const inTimelineOrMap = target?.closest('.timeline-dock, .atlas-map');
      if (!inTimelineOrMap) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft') {
        trackDebounced('timeline_seek', { source: 'keyboard', target: 'previous_minute' });
        event.preventDefault();
        setTimelineIntent('manual');
        setTimeMs((value) => Math.max(timelineBounds.start, value - 60_000));
      } else if (event.key === 'ArrowRight') {
        trackDebounced('timeline_seek', { source: 'keyboard', target: 'next_minute' });
        event.preventDefault();
        setTimelineIntent('manual');
        setTimeMs((value) => Math.min(timelineBounds.end, value + 60_000));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawer, presentationMode, exitPresentation, togglePlayback, timelineBounds]);

  useEffect(() => {
    if (!data || playing) return;
    const params = new URLSearchParams();
    params.set('e', eventDate);
    if (selected) {
      params.set('lat', selected.lat.toFixed(6));
      params.set('lon', selected.lon.toFixed(6));
      if (selected.elevation) params.set('elv', selected.elevation.toFixed(0));
      if (timezoneOverride) params.set('tz', timezoneOverride);
    }
    params.set('mapLat', mapCenter.lat.toFixed(5));
    params.set('mapLon', mapCenter.lon.toFixed(5));
    params.set('z', mapCenter.zoom.toFixed(2));
    if (baseMap !== 'street') params.set('style', baseMap);
    const activeLayers = (Object.keys(layers) as Array<keyof LayerVisibility>).filter(
      (key) => layers[key],
    );
    params.set('layers', activeLayers.join(','));
    if (Math.abs(nightOpacity - 0.62) > 0.01) {
      params.set('nightOpacity', nightOpacity.toFixed(2));
    }
    if (presentationMode) params.set('present', '1');
    if (Math.abs(timeMs - data.greatestTime.getTime()) > 60_000) {
      params.set('t', new Date(timeMs).toISOString());
    }
    window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
  }, [
    data,
    eventDate,
    selected,
    timezoneOverride,
    baseMap,
    mapCenter,
    layers,
    nightOpacity,
    timeMs,
    playing,
    presentationMode,
  ]);

  const changeEvent = useCallback(async (date: string, source = 'catalog') => {
    trackEvent('eclipse_select', { eclipse: date, source });
    setLoading(true);
    setLoadError('');
    setPlaying(false);
    setDrawer(null);
    setProfile(null);
    setProfileLoading(false);
    setTimelineIntent('auto');
    setEventDate(date);
    setSheetSnap('peek');
  }, []);

  const stepEvent = useCallback(
    async (direction: -1 | 1) => {
      try {
        const next = await getAdjacentEclipseDate(eventDate, direction);
        if (next) changeEvent(next, direction === 1 ? 'next' : 'previous');
        else showToast('End of the eclipse catalog');
      } catch {
        trackEvent('service_error', { service: 'adjacent_eclipse' });
        showToast('Could not load the adjacent eclipse');
      }
    },
    [eventDate, changeEvent, showToast],
  );

  const openCatalog = useCallback(() => {
    setDrawer('catalog');
    if (!catalogSearched) {
      window.setTimeout(() => {
        document.querySelector<HTMLButtonElement>('[data-catalog-search]')?.click();
      }, 30);
    }
  }, [catalogSearched]);

  const openVisibleEclipses = useCallback(() => {
    if (!selected) return;
    const year = parseEclipseDate(eventDate).year;
    setFromYear(Math.max(-1999, year));
    setToYear(Math.min(3000, year + 100));
    setVisibleHere(true);
    setCentralOnly(false);
    setCatalogSearched(false);
    setDrawer('catalog');
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-catalog-search]')?.click();
    }, 80);
  }, [eventDate, selected]);

  const runCatalogSearch = useCallback(async () => {
    setCatalogError('');
    const startedAt = performance.now();
    trackEvent('catalog_search', { from_year: fromYear, to_year: toYear, types: typeFilters.join(','), visible_here: visibleHere, central_only: centralOnly, min_duration: minDuration, sort: catalogSort, saros: Number(sarosFilter) || 0 });
    if (fromYear < -1999 || toYear > 3000 || fromYear > toYear) {
      trackEvent('catalog_result', { status: 'invalid' });
      setCatalogError('Use a valid range from 1999 BCE to 3000 CE.');
      return;
    }
    if (visibleHere && !selected) {
      trackEvent('catalog_result', { status: 'invalid' });
      setCatalogError('Choose a location first.');
      return;
    }
    if (visibleHere && toYear - fromYear > 300) {
      trackEvent('catalog_result', { status: 'invalid' });
      setCatalogError('Location searches are limited to 300 years at a time.');
      return;
    }
    setCatalogLoading(true);
    setCatalogProgress(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const entries = await searchCatalogue(
        fromYear,
        toYear,
        setCatalogProgress,
        visibleHere && selected ? { location: selected, centralOnly } : undefined,
      );
      const saros = sarosFilter.trim() ? Number(sarosFilter) : null;
      const filtered = entries.filter(
        (entry) =>
          typeFilters.includes(entry.type) &&
          entry.durationSeconds >= minDuration * 60 &&
          (saros === null || entry.saros === saros),
      );
      filtered.sort((a, b) => {
        if (catalogSort === 'duration') return b.durationSeconds - a.durationSeconds;
        if (catalogSort === 'magnitude') return b.magnitude - a.magnitude;
        return compareEclipseDates(a.date, b.date);
      });
      trackEvent('catalog_result', { status: 'success', count: filtered.length, duration_ms: Math.round(performance.now() - startedAt) });
      setCatalogResults(filtered);
      setCatalogSearched(true);
    } catch (error) {
      trackEvent('catalog_result', { status: 'error' });
      setCatalogError(error instanceof Error ? error.message : 'The catalog could not be searched.');
    } finally {
      setCatalogLoading(false);
      setCatalogProgress(1);
    }
  }, [
    fromYear,
    toYear,
    visibleHere,
    selected,
    centralOnly,
    sarosFilter,
    typeFilters,
    minDuration,
    catalogSort,
  ]);

  const submitPlaceSearch = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!placeQuery.trim()) return;
      const coordinateMatch = placeQuery
        .trim()
        .match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
      if (coordinateMatch) {
        const lat = Number(coordinateMatch[1]);
        const lon = Number(coordinateMatch[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          trackEvent('place_search', { mode: 'coordinates' });
          choosePoint(lat, lon, 'Selected point', undefined, undefined, 'coordinates');
          setDrawer(null);
          return;
        }
      }
      trackEvent('place_search', { mode: 'name' });
      setPlaceLoading(true);
      setPlaceError('');
      try {
        const results = await searchPlaces(placeQuery.trim());
        trackEvent('place_search_result', { status: 'success', count: results.length });
        setPlaceResults(results);
        if (!results.length) setPlaceError('No places found. Try a region or country.');
      } catch {
        trackEvent('place_search_result', { status: 'error' });
        setPlaceError('Place search is temporarily unavailable.');
      } finally {
        setPlaceLoading(false);
      }
    },
    [placeQuery, choosePoint],
  );

  const submitCoordinates = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      trackEvent('place_search', { mode: 'coordinates' });
      const values = new FormData(event.currentTarget);
      const lat = Number(values.get('latitude'));
      const lon = Number(values.get('longitude'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        trackEvent('place_search_result', { status: 'invalid' });
        setPlaceError('Use a latitude from −90 to 90 and longitude from −180 to 180.');
        return;
      }
      setPlaceError('');
      choosePoint(lat, lon, 'Selected point', undefined, undefined, 'coordinates');
      setDrawer(null);
    },
    [choosePoint],
  );

  const choosePlace = useCallback(
    (place: PlaceResult | SelectedLocation, source = 'saved') => {
      choosePoint(
        place.lat,
        place.lon,
        place.name,
        'accuracy' in place ? place.accuracy : undefined,
        'elevation' in place ? place.elevation : undefined,
        source,
      );
      setDrawer(null);
    },
    [choosePoint],
  );

  const saveCurrentPlace = useCallback(() => {
    if (!selected) return;
    const exists = savedPlaces.some(
      (place) => Math.abs(place.lat - selected.lat) < 0.00001 && Math.abs(place.lon - selected.lon) < 0.00001,
    );
    const next = exists
      ? savedPlaces.filter(
          (place) => Math.abs(place.lat - selected.lat) >= 0.00001 || Math.abs(place.lon - selected.lon) >= 0.00001,
        )
      : [selected, ...savedPlaces].slice(0, 12);
    trackEvent('location_save', { action: exists ? 'remove' : 'save', count: next.length });
    setSavedPlaces(next);
    localStorage.setItem('umbra-saved-places', JSON.stringify(next));
    showToast(exists ? 'Place removed' : 'Place saved on this device');
  }, [selected, savedPlaces, showToast]);

  const updateSelectedElevation = useCallback(
    (elevation: number) => {
      trackDebounced('location_elevation');
      setElevationStatus('provided');
      setProfile(null);
      setProfileLoading(false);
      setSelected((current) => (current ? { ...current, elevation } : current));
      if (!selected) return;
      setSavedPlaces((current) => {
        const index = current.findIndex((place) => locationKey(place) === locationKey(selected));
        if (index < 0) return current;
        const next = [...current];
        next[index] = { ...next[index], elevation };
        localStorage.setItem('umbra-saved-places', JSON.stringify(next));
        return next;
      });
    },
    [selected],
  );

  const copyText = useCallback(
    async (value: string, message = 'Copied', kind = 'embed') => {
      try {
        await navigator.clipboard.writeText(value);
        trackEvent('copy', { kind, status: 'success' });
        showToast(message);
        return true;
      } catch {
        trackEvent('copy', { kind, status: 'error' });
        showToast('Copy failed');
        return false;
      }
    },
    [showToast],
  );

  const shareView = useCallback(async () => {
    const localSummary =
      selected && local
        ? typeSentence(local.type, observability(local)) +
          (local.maximum
            ? ' — ' + percent(local.obscuration) + ' covered, maximum ' +
              formatTime(local.maximum.date, timezoneOverride || timezone)
            : '')
        : '';
    const payload = {
      title: data ? formatDateLabel(data.date) + ' solar eclipse' : 'Umbra eclipse map',
      text: selected ? selected.name + ': ' + localSummary : 'Explore this solar eclipse',
      url: window.location.href,
    };
    const method = typeof navigator.share === 'function' ? 'native' : 'clipboard';
    trackEvent('share', { method, status: 'requested' });
    try {
      if (navigator.share) {
        await navigator.share(payload);
        trackEvent('share', { method, status: 'success' });
      } else {
        const copied = await copyText(window.location.href, 'Link copied', 'share_link');
        trackEvent('share', { method, status: copied ? 'success' : 'error' });
      }
    } catch (error) {
      trackEvent('share', { method, status: error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error' });
    }
  }, [data, selected, local, timezone, timezoneOverride, copyText]);

  const exportData = useCallback(
    async (kind: 'geojson' | 'kml' | 'kmz' | 'gpx' | 'csv' | 'ics') => {
      if (!data) return;
      trackEvent('export', { format: kind, status: 'requested', eclipse: data.date, has_location: !!selected });
      try {
        const baseName = 'solar-eclipse-' + data.date;
        const coordinates = (points: Array<{ lat: number; lon: number }>) =>
          points.map((point) => point.lon.toFixed(6) + ',' + point.lat.toFixed(6)).join(' ');
        const polygonCoordinates = (points: Array<{ lat: number; lon: number }>) => {
          const ring = points.map((point) => [point.lon, point.lat]);
          if (
            ring.length &&
            (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
          ) {
            ring.push([...ring[0]]);
          }
          return ring;
        };
        const buildKml = () => {
          const centerLineKml = data.geometry.centralLine.length >= 2
            ? '<Placemark><name>Center line</name><LineString><tessellate>1</tessellate><coordinates>' +
              coordinates(data.geometry.centralLine) +
              '</coordinates></LineString></Placemark>'
            : '';
          const centralPathKml = data.geometry.umbra.length >= 3
            ? '<Placemark><name>Central path</name><Polygon><outerBoundaryIs><LinearRing><coordinates>' +
              coordinates([...data.geometry.umbra, data.geometry.umbra[0]]) +
              '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>'
            : '';
          const visibilityKml = data.geometry.penumbra.length >= 3
            ? '<Placemark><name>Partial visibility</name><Polygon><outerBoundaryIs><LinearRing><coordinates>' +
              coordinates([...data.geometry.penumbra, data.geometry.penumbra[0]]) +
              '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>'
            : '';
          return (
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
            '<name>' + xmlEscape(formatDateLabel(data.date) + ' solar eclipse') + '</name>' +
            centerLineKml +
            centralPathKml +
            visibilityKml +
            '</Document></kml>'
          );
        };
        if (kind === 'geojson') {
          const features: object[] = [];
          if (data.geometry.umbra.length >= 3) {
            features.push({
              type: 'Feature',
              properties: { name: 'Central path', eclipse: data.date, type: data.type },
              geometry: {
                type: 'Polygon',
                coordinates: [polygonCoordinates(data.geometry.umbra)],
              },
            });
          }
          if (data.geometry.centralLine.length >= 2) {
            features.push({
              type: 'Feature',
              properties: { name: 'Center line', eclipse: data.date },
              geometry: {
                type: 'LineString',
                coordinates: data.geometry.centralLine.map((point) => [point.lon, point.lat]),
              },
            });
          }
          if (data.geometry.penumbra.length >= 3) {
            features.push({
              type: 'Feature',
              properties: { name: 'Partial visibility', eclipse: data.date },
              geometry: {
                type: 'Polygon',
                coordinates: [polygonCoordinates(data.geometry.penumbra)],
              },
            });
          }
          if (selected) {
            features.push({
              type: 'Feature',
              properties: { name: selected.name, elevation: selected.elevation },
              geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] },
            });
          }
          downloadText(
            baseName + '.geojson',
            'application/geo+json',
            JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
          );
        } else if (kind === 'kml') {
          downloadText(baseName + '.kml', 'application/vnd.google-earth.kml+xml', buildKml());
        } else if (kind === 'kmz') {
          const { default: JSZip } = await import('jszip');
          const archive = new JSZip();
          archive.file('doc.kml', buildKml());
          downloadBlob(
            baseName + '.kmz',
            await archive.generateAsync({
              type: 'blob',
              compression: 'DEFLATE',
              mimeType: 'application/vnd.google-earth.kmz',
            }),
          );
        } else if (kind === 'gpx') {
          const trackPoints = data.geometry.centralLine.length
            ? data.geometry.centralLine
            : data.geometry.penumbra;
          if (trackPoints.length < 2) {
            trackEvent('export', { format: kind, status: 'unavailable' });
            showToast('No path geometry is available for this eclipse');
            return;
          }
          const trackName = data.geometry.centralLine.length
            ? 'Solar eclipse center line'
            : 'Partial visibility boundary';
          const track = trackPoints
            .map((point) => '<trkpt lat="' + point.lat.toFixed(6) + '" lon="' + point.lon.toFixed(6) + '"/>')
            .join('');
          const gpx =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<gpx version="1.1" creator="Umbra" xmlns="http://www.topografix.com/GPX/1/1">' +
            '<metadata><name>' + xmlEscape(formatDateLabel(data.date) + ' path') + '</name></metadata>' +
            '<trk><name>' + trackName + '</name><trkseg>' + track + '</trkseg></trk></gpx>';
          downloadText(baseName + '.gpx', 'application/gpx+xml', gpx);
        } else if (kind === 'csv') {
          if (!local || !selected) {
            trackEvent('export', { format: kind, status: 'needs_location' });
            showToast('Choose a location to export local contacts');
            return;
          }
          const localZone = timezoneOverride || timezone;
          const generatedAt = new Date().toISOString();
          const rows = [
            [
              'schema_version',
              'generated_at',
              'eclipse_date',
              'global_type',
              'saros',
              'site_name',
              'latitude_deg',
              'longitude_deg',
              'elevation_m',
              'timezone',
              'local_type',
              'contact',
              'utc_time',
              'local_time',
              'altitude_deg',
              'azimuth_deg',
              'magnitude',
              'obscuration',
            ],
            ...local.contacts.map((contact) => [
              '1',
              generatedAt,
              data.date,
              data.type,
              data.saros,
              selected.name,
              selected.lat.toFixed(6),
              selected.lon.toFixed(6),
              selected.elevation.toFixed(1),
              localZone,
              local.type,
              contact.shortLabel,
              contact.date.toISOString(),
              formatTime(contact.date, localZone),
              contact.altitude.toFixed(3),
              contact.azimuth.toFixed(3),
              contact.magnitude.toFixed(6),
              contact.obscuration.toFixed(6),
            ]),
          ];
          downloadText(
            baseName + '-' + selected.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv',
            'text/csv',
            rows.map((row) => row.map(csvCell).join(',')).join('\n'),
          );
        } else {
          const first = local?.contacts.find((contact) => contact.key === 'c1')?.date ?? data.rangeStart;
          const last = local?.contacts.find((contact) => contact.key === 'c4')?.date ?? data.rangeEnd;
          const localKind = local?.type && local.type !== 'none'
            ? local.type.charAt(0).toUpperCase() + local.type.slice(1)
            : TYPE_LABELS[data.type];
          const description = [
            local && selected ? typeSentence(local.type, observability(local)) + ' from ' + selected.name + '.' : TYPE_LABELS[data.type] + ' solar eclipse.',
            local?.maximum ? percent(local.obscuration) + ' of the Sun covered at maximum ' + formatTime(local.maximum.date, timezoneOverride || timezone) + '.' : '',
            local?.maximum ? 'Sun ' + local.maximum.altitude.toFixed(1) + '° high toward ' + Math.round(local.maximum.azimuth) + '°.' : '',
            local ? safetySentence(local.type, observability(local)) : 'Use certified eclipse eye protection.',
            'Check weather and official local guidance before travel.',
          ].filter(Boolean).join(' ');
          const uidLocation = selected
            ? '-' + selected.lat.toFixed(5).replace('-', 'm') + '-' + selected.lon.toFixed(5).replace('-', 'm')
            : '-global';
          const ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Umbra//Solar Eclipse Atlas//EN',
            'BEGIN:VEVENT',
            'UID:' + data.date + uidLocation + '@umbra.eclipse',
            'DTSTAMP:' + icsDate(new Date()),
            'DTSTART:' + icsDate(first),
            'DTEND:' + icsDate(last),
            'SUMMARY:' + icsEscape(localKind + ' solar eclipse' + (selected ? ' · ' + selected.name : '')),
            'DESCRIPTION:' + icsEscape(description),
            selected ? 'LOCATION:' + icsEscape(selected.name) : '',
            'URL:' + icsEscape(window.location.href),
            'END:VEVENT',
            'END:VCALENDAR',
          ]
            .filter(Boolean)
            .join('\r\n');
          downloadText(baseName + '.ics', 'text/calendar', ics);
        }
        trackEvent('export', { format: kind, status: 'success', eclipse: data.date, has_location: !!selected });
        showToast(kind.toUpperCase() + ' downloaded');
      } catch {
        trackEvent('export', { format: kind, status: 'error' });
        showToast('The export could not be created. Try again.');
      }
    },
    [data, selected, local, timezone, timezoneOverride, showToast],
  );

  const toggleComparison = useCallback(
    (date: string) => {
      if (date === eventDate) {
        showToast('This eclipse is already on the map');
        return;
      }
      const removing = comparisonDates.includes(date);
      if (!removing && comparisonDates.length >= 3) {
        trackEvent('comparison_change', { action: 'limit', count: comparisonDates.length });
        showToast('Compare up to three eclipses');
        return;
      }
      const next = removing ? comparisonDates.filter((item) => item !== date) : [...comparisonDates, date];
      trackEvent('comparison_change', { action: removing ? 'remove' : 'add', eclipse: date, count: next.length });
      setComparisonDates(next);
    },
    [eventDate, comparisonDates, showToast],
  );

  const setLayer = (key: keyof LayerVisibility, value: boolean) => {
    trackEvent('layer_toggle', { layer: key, enabled: value });
    setLayers((current) => ({ ...current, [key]: value }));
  };

  const applyLayerPreset = (preset: LayerPreset) => {
    trackEvent('layer_preset', { preset });
    setLayers({ ...LAYER_PRESETS[preset] });
  };

  const activeLayerPreset = LAYER_PRESET_LABELS.find(({ id }) =>
    (Object.keys(LAYER_PRESETS[id]) as Array<keyof LayerVisibility>).every(
      (key) => LAYER_PRESETS[id][key] === layers[key],
    ),
  )?.id;

  const cycleSheet = () => {
    const next = sheetSnap === 'peek' ? 'mid' : sheetSnap === 'mid' ? 'full' : 'peek';
    if (next === 'peek') eventPanelScrollRef.current?.scrollTo({ top: 0 });
    trackEvent('sheet_resize', { size: next, source: 'button' });
    setSheetSnap(next);
  };

  const startSheetDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.innerWidth > 760 || !event.isPrimary || event.button !== 0) return;
    const panel = event.currentTarget.closest<HTMLElement>('.event-panel');
    if (!panel) return;
    sheetDragCleanupRef.current?.();
    const drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      // The mobile sheet keeps a full-height compositor layer and reveals the
      // active snap with translateY. Measure only the visible portion so direct
      // manipulation stays under the finger.
      startHeight: window.innerHeight - panel.getBoundingClientRect().top,
      moved: false,
    };
    sheetDragRef.current = drag;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const delta = drag.startY - moveEvent.clientY;
      if (Math.abs(delta) > 6) drag.moved = true;
      const minimum = selected ? 218 : window.innerWidth <= 390 ? 306 : 302;
      const maximum = Math.max(minimum, window.innerHeight - 62);
      setSheetDragHeight(Math.max(minimum, Math.min(maximum, drag.startHeight + delta)));
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      sheetDragCleanupRef.current = null;
    };

    const finish = (finishEvent: PointerEvent, cancelled = false) => {
      if (finishEvent.pointerId !== drag.pointerId) return;
      cleanup();
      sheetDragRef.current = null;
      if (!cancelled && drag.moved) {
        const delta = drag.startY - finishEvent.clientY;
        const order: SheetSnap[] = ['peek', 'mid', 'full'];
        const current = order.indexOf(sheetSnap);
        const direction = Math.abs(delta) >= 32 ? (delta > 0 ? 1 : -1) : 0;
        const next = Math.max(0, Math.min(order.length - 1, current + direction));
        if (order[next] === 'peek') eventPanelScrollRef.current?.scrollTo({ top: 0 });
        trackEvent('sheet_resize', { size: order[next], source: 'drag' });
        setSheetSnap(order[next]);
        lastSheetDragAtRef.current = performance.now();
      }
      setSheetDragHeight(null);
    };

    const cancel = (cancelEvent: PointerEvent) => finish(cancelEvent, true);
    sheetDragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    setSheetDragHeight(drag.startHeight);
  };

  const handleSheetClick = () => {
    if (performance.now() - lastSheetDragAtRef.current < 400) return;
    cycleSheet();
  };

  const currentIsSaved =
    !!selected &&
    savedPlaces.some(
      (place) => Math.abs(place.lat - selected.lat) < 0.00001 && Math.abs(place.lon - selected.lon) < 0.00001,
    );

  const eventColor = data ? colorForType(data.type) : '#D9516E';
  const eventStyle = {
    '--event-color': eventColor,
    ...(sheetDragHeight === null ? {} : { '--mobile-sheet': `${sheetDragHeight}px` }),
  } as CSSProperties;
  const isNextEclipse = data?.date === DEFAULT_DATE;

  return (
    <main
      className={
        'atlas-app sheet-' + sheetSnap +
        (selected ? ' has-selection' : '') +
        (sheetDragHeight === null ? '' : ' sheet-dragging') +
        (presentationMode ? ' presentation-mode' : '')
      }
      style={eventStyle}
    >
      <a className="skip-link" href="#eclipse-details">Skip interactive map</a>
      <p id="map-instructions" className="sr-only">
        Pan and zoom with touch, pointer, or the map controls. Select a point to calculate local
        circumstances. Use the text map summary in More for a non-visual description.
      </p>
      <div
        ref={mapContainerRef}
        className="atlas-map"
        role="region"
        aria-label="Interactive solar eclipse map"
        aria-describedby="map-instructions"
        tabIndex={0}
      />
      {mapReady && !selected && !presentationMode && (
        <div className="map-start-hint" role="note">
          <span className="map-hint-target" aria-hidden="true">
            <MapPin size={16} />
          </span>
          <span>
            <strong>Choose any point on the map</strong>
            <small>Tap or click to see the eclipse there</small>
          </span>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {data
          ? TYPE_LABELS[data.type] + ' eclipse on ' + formatDateLabel(data.date) + '. ' +
            (selected && local ? typeSentence(local.type, localObservability) + ' for ' + selected.name + '.' : '')
          : 'Loading eclipse.'}
      </p>

      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => { trackEvent('map_fit'); if (data && mapRef.current) fitEclipse(mapRef.current, data, window.innerWidth > 760 ? 410 : 0); }}
          aria-label="Umbra — fit the eclipse path"
        >
          <span className="brand-eclipse" aria-hidden="true"><span /></span>
          <span>Umbra</span>
        </button>
        <button className="place-search-trigger" type="button" onClick={() => setDrawer('search')}>
          <Search size={17} aria-hidden="true" />
          <span>{selected ? selected.name : 'Search a place'}</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="topbar-actions">
          <button className="square-button desktop-only" type="button" onClick={shareView} aria-label="Share this view">
            <Share2 size={18} aria-hidden="true" />
          </button>
          <button
            className="square-button"
            type="button"
            onClick={() => setDrawer(drawer === 'more' ? null : 'more')}
            aria-label="Open menu"
            aria-expanded={drawer === 'more'}
            data-open-more
          >
            <Menu size={19} aria-hidden="true" />
          </button>
        </div>
      </header>

      {presentationMode && data && (
        <section className="presentation-card" aria-label="Presentation caption">
          <div>
            <span>{formatDateLabel(data.date)} · {TYPE_LABELS[data.type]}</span>
            <strong>{eventRegion(data.date, data.greatest)}</strong>
            <small>
              Shading shows where a partial eclipse is visible; the band is the central path and
              the line marks its center. Move the timeline to follow the Moon’s shadow.
            </small>
          </div>
          <button type="button" onClick={exitPresentation}>
            <X size={16} aria-hidden="true" /> Exit
          </button>
        </section>
      )}

      <aside ref={eventPanelRef} id="eclipse-details" className="event-panel" aria-label="Eclipse details">
        <button
          className="sheet-grabber"
          type="button"
          onClick={handleSheetClick}
          onPointerDown={startSheetDrag}
          aria-label="Drag or tap to resize details panel"
          aria-expanded={sheetSnap !== 'peek'}
        >
          <span />
        </button>
        <div ref={eventPanelScrollRef} className="event-panel-scroll">
          <div className="event-nav">
            <button type="button" onClick={() => stepEvent(-1)} aria-label="Previous eclipse">
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <button className="event-switcher" type="button" onClick={openCatalog}>
              <CalendarDays size={15} aria-hidden="true" />
              <span>All solar eclipses</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => stepEvent(1)} aria-label="Next eclipse">
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>

          {loadError ? (
            <div className="panel-error" role="alert">
              <strong>That eclipse could not be opened.</strong>
              <span>{loadError}</span>
              <button type="button" onClick={openCatalog}>Browse the catalog</button>
            </div>
          ) : (
            <>
              <section className="event-intro">
                <div className="eyebrow-row">
                  <span className="type-dot" />
                  <span>
                    {data
                      ? isNextEclipse
                        ? 'Next solar eclipse'
                        : 'Solar eclipse atlas'
                      : 'Loading eclipse'}
                  </span>
                  {data && <span className="relative-date">{relativeDateLabel(data.date)}</span>}
                </div>
                <h1>{data ? TYPE_LABELS[data.type] + ' solar eclipse' : 'Tracing the Moon’s shadow…'}</h1>
                {data ? (
                  <div className="event-context">
                    <time dateTime={data.date}>{formatDateLabel(data.date)}</time>
                    <p>
                      <span>{data.type === 'partial' ? 'Best visibility' : 'Map follows the shadow'}</span>
                      <strong>{eventRegion(data.date, data.greatest)}</strong>
                    </p>
                  </div>
                ) : (
                  <p className="event-loading-copy">Loading calculations and path geometry.</p>
                )}
              </section>

              {!selected ? (
                <section className="choose-location-card">
                  <div>
                    <MapPin size={18} aria-hidden="true" />
                    <div>
                      <strong>Will you see it?</strong>
                      <span>Check coverage, local times and the Sun’s position.</span>
                    </div>
                  </div>
                  <div className="choose-actions">
                    <button type="button" onClick={() => setDrawer('search')}>Search place</button>
                    <button type="button" onClick={startLocationTracking} disabled={tracking}>
                      <LocateFixed size={15} aria-hidden="true" /> {tracking ? 'Finding…' : 'Use my location'}
                    </button>
                  </div>
                  {savedPlaces[0] && (
                    <button
                      className="recent-place"
                      type="button"
                      onClick={() => choosePlace(savedPlaces[0], 'saved')}
                    >
                      <Bookmark size={14} fill="currentColor" aria-hidden="true" /> Saved: {savedPlaces[0].name}
                    </button>
                  )}
                  {locationError && <p className="location-error" role="alert">{locationError}</p>}
                </section>
              ) : (
                <section className="local-section">
                  <div className="location-heading">
                    <div>
                      <span>Selected location</span>
                      <h2>{selected.name}</h2>
                      <p>
                        {formatCoordinate(selected.lat, true)} · {formatCoordinate(selected.lon, false)}
                        {selected.elevation ? ' · ' + Math.round(selected.elevation) + ' m' : ''}
                      </p>
                      {elevationStatus === 'loading' && <small className="elevation-status">Finding elevation…</small>}
                      {elevationStatus === 'unavailable' && (
                        <small className="elevation-status warning">Elevation unavailable; calculations assume 0 m.</small>
                      )}
                    </div>
                    <button
                      className={currentIsSaved ? 'mini-icon active' : 'mini-icon'}
                      type="button"
                      onClick={saveCurrentPlace}
                      aria-label={currentIsSaved ? 'Remove saved place' : 'Save this place'}
                    >
                      <Bookmark size={17} fill={currentIsSaved ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  </div>

                  <div
                    key={`${eventDate}:${selected.lat.toFixed(5)}:${selected.lon.toFixed(5)}`}
                    className={'visibility-verdict verdict-' + (local?.type ?? 'none') + ' observability-' + localObservability}
                  >
                    <span className="verdict-icon">{local?.type === 'none' ? <Moon size={19} /> : <Sun size={19} />}</span>
                    <div>
                      <strong>{typeSentence(local?.type ?? 'none', localObservability)}</strong>
                      {local && local.type !== 'none' && local.maximum && (
                        <span className="verdict-metrics">
                          {percent(local.obscuration)} covered · maximum {formatTime(local.maximum.date, displayZone).replace(/ [A-Z+].*$/, '')}
                        </span>
                      )}
                      <span className="verdict-detail">{typeDetail(local?.type ?? 'none', localObservability)}</span>
                    </div>
                  </div>

                  <p className="inline-safety"><Sun size={15} aria-hidden="true" />{safetySentence(local?.type ?? 'none', localObservability)}</p>

                  {local?.type === 'none' && (
                    <div className="not-visible-actions">
                      <button type="button" onClick={() => setDrawer('search')}>Change place</button>
                      <button
                        type="button"
                        onClick={() => {
                          trackEvent('map_fit');
                          setSheetSnap('peek');
                          if (data && mapRef.current) fitEclipse(mapRef.current, data, window.innerWidth > 760 ? 410 : 0);
                        }}
                      >
                        Show visibility area
                      </button>
                      <button
                        type="button"
                        onClick={openVisibleEclipses}
                      >
                        Find an eclipse visible here
                      </button>
                    </div>
                  )}

                  {local && local.type !== 'none' && (
                    <>
                      <div className="local-stats">
                        <div><span>Maximum time</span><strong>{local.maximum ? formatTime(local.maximum.date, displayZone).replace(/ [A-Z+].*$/, '') : '—'}</strong></div>
                        <div><span>Sun covered</span><strong>{percent(local.obscuration)}</strong></div>
                        <div>
                          <span>Sun at maximum</span>
                          <strong>{local.maximum ? local.maximum.altitude.toFixed(1) + '° · ' + Math.round(local.maximum.azimuth) + '° ' + compassDirection(local.maximum.azimuth) : '—'}</strong>
                        </div>
                        <div><span>{local.type === 'partial' ? 'Partial phase' : local.type === 'total' ? 'Totality' : 'Annularity'}</span><strong>{formatDuration(local.type === 'partial' ? local.durationSeconds : local.centralDurationSeconds, true)}</strong></div>
                      </div>

                      <div className="field-tools">
                        <button type="button" onClick={() => exportData('ics')}>
                          <CalendarDays size={16} aria-hidden="true" /> Add to calendar
                        </button>
                        <button type="button" onClick={shareView}>
                          <Share2 size={16} aria-hidden="true" /> Share this spot
                        </button>
                      </div>

                      {profileLoading && (
                        <p className="horizon-status" role="status">
                          <span className="tiny-spinner" /> Building terrain skyline…
                        </p>
                      )}
                      {profile && (
                        <>
                          <HorizonCard profile={profile} sunAltitude={local.maximum?.altitude ?? 0} />
                          <a
                            className="peakfinder-link"
                            href={'https://www.peakfinder.com/?lat=' + selected.lat + '&lng=' + selected.lon}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View named peaks in PeakFinder
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        </>
                      )}

                      {liveCircumstances && (
                        <div className="sun-moon-card">
                          <div className="eclipse-diagram" aria-hidden="true">
                            <span className="sun-disc" />
                            <span
                              className="moon-disc"
                              style={
                                {
                                  '--moon-size': Math.max(0.72, Math.min(1.25, local.moonSunRatio)),
                                  '--moon-offset': Math.min(
                                    42,
                                    Math.max(
                                      0,
                                      1 + local.moonSunRatio - 2 * liveCircumstances.magnitude,
                                    ) * 27,
                                  ),
                                } as CSSProperties
                              }
                            />
                          </div>
                          <div>
                            <span>At selected timeline time · {formatTime(new Date(timeMs), displayZone).replace(/ [A-Z+].*$/, '')}</span>
                            <strong>{percent(liveCircumstances.obscuration)} of the Sun covered</strong>
                            <small>{liveCircumstances.altitude.toFixed(1)}° high · {compassDirection(liveCircumstances.azimuth)} azimuth</small>
                          </div>
                        </div>
                      )}

                      <div className="section-title-row">
                        <div>
                          <span>Local contacts</span>
                          <small>{displayZone === 'UTC' ? 'Universal time' : displayZone.replaceAll('_', ' ')}</small>
                        </div>
                        <div className="segmented mini">
                          <button className={timeMode === 'local' ? 'active' : ''} type="button" aria-pressed={timeMode === 'local'} onClick={() => { trackEvent('preference_change', { preference: 'clock', value: 'local' }); setTimeMode('local'); }}>Local</button>
                          <button className={timeMode === 'utc' ? 'active' : ''} type="button" aria-pressed={timeMode === 'utc'} onClick={() => { trackEvent('preference_change', { preference: 'clock', value: 'utc' }); setTimeMode('utc'); }}>UTC</button>
                        </div>
                      </div>
                      <div className="contact-list">
                        {local.contacts.map((contact) => (
                          <button
                            type="button"
                            key={contact.key}
                            className={Math.abs(contact.date.getTime() - timeMs) < 30_000 ? 'contact-row active' : 'contact-row'}
                            aria-current={Math.abs(contact.date.getTime() - timeMs) < 30_000 ? 'time' : undefined}
                            onClick={() => {
                              setPlaying(false);
                              setTimelineIntent('manual');
                              trackEvent('timeline_seek', { source: 'contact', target: contact.key });
                              setTimeMs(contact.date.getTime());
                            }}
                          >
                            <span className="contact-code">{contact.shortLabel}</span>
                            <span className="contact-name">{contact.label}</span>
                            <span className="contact-sky">
                              <i className={contact.altitude < -0.8 ? 'below' : ''} />
                              {contact.altitude.toFixed(1)}° · {Math.round(contact.azimuth)}° {compassDirection(contact.azimuth)}
                            </span>
                            <strong>{formatTime(contact.date, displayZone).replace(/ [A-Z+].*$/, '')}</strong>
                          </button>
                        ))}
                      </div>

                      <UpcomingEclipsesPanel
                        results={upcomingEclipses}
                        loading={upcomingLoading}
                        error={upcomingError}
                        afterDate={eventDate}
                        onOpen={(date) => changeEvent(date, 'upcoming')}
                        onBrowse={openVisibleEclipses}
                      />

                      <LocationComparison
                        items={locationComparisons}
                        selected={selected}
                        bestKey={bestComparisonKey}
                        timeMode={timeMode}
                        onChoose={(place) => choosePlace(place, 'comparison')}
                      />

                      <details className="precision-details" onToggle={(event) => trackEvent('detail_toggle', { section: 'precision', open: event.currentTarget.open })}>
                        <summary>Planning details <ChevronDown size={15} aria-hidden="true" /></summary>
                        <dl>
                          <div><dt>Magnitude</dt><dd>{local.magnitude.toFixed(4)}</dd></div>
                          {Number.isFinite(local.centerDistanceKm) && (
                            <div><dt>Center line</dt><dd>{distanceLabel(local.centerDistanceKm, distanceUnit)} {compassDirection(local.centerBearing)}</dd></div>
                          )}
                          <div>
                            <dt>
                              {local.type === 'partial'
                                ? data?.geometry.umbra.length
                                  ? 'Central path edge'
                                  : 'Visibility edge'
                                : 'Nearest edge'}
                            </dt>
                            <dd>{distanceLabel(local.edgeDistanceKm, distanceUnit)}</dd>
                          </div>
                          {local.type !== 'partial' && (
                            <div><dt>Path width</dt><dd>{distanceLabel(local.pathWidthMeters / 1000, distanceUnit)}</dd></div>
                          )}
                          <div><dt>Moon / Sun</dt><dd>{local.moonSunRatio.toFixed(4)}</dd></div>
                          <div>
                            <dt>Elevation</dt>
                            <dd>
                              <input
                                type="number"
                                min="-500"
                                max="9000"
                                step="1"
                                value={Math.round(selected.elevation)}
                                onChange={(event) => updateSelectedElevation(Number(event.target.value) || 0)}
                                aria-label="Observer elevation in metres"
                              />
                              <span>m</span>
                            </dd>
                          </div>
                          <div>
                            <dt>Time zone</dt>
                            <dd>
                              <select
                                value={timezoneOverride || timezone}
                                onChange={(event) => { trackEvent('location_timezone'); setTimezoneOverride(event.target.value); }}
                                aria-label="Observer time zone"
                              >
                                {!supportedTimezones.includes(timezone) && <option value={timezone}>{timezone}</option>}
                                {supportedTimezones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
                              </select>
                            </dd>
                          </div>
                          <div><dt>Coordinates</dt><dd>{toDms(selected.lat, true)}<br />{toDms(selected.lon, false)}</dd></div>
                        </dl>
                      </details>
                    </>
                  )}
                  {local?.type === 'none' && (
                    <>
                      <UpcomingEclipsesPanel
                        results={upcomingEclipses}
                        loading={upcomingLoading}
                        error={upcomingError}
                        afterDate={eventDate}
                        onOpen={(date) => changeEvent(date, 'upcoming')}
                        onBrowse={openVisibleEclipses}
                      />
                      <LocationComparison
                        items={locationComparisons}
                        selected={selected}
                        bestKey={bestComparisonKey}
                        timeMode={timeMode}
                        onChoose={(place) => choosePlace(place, 'comparison')}
                      />
                    </>
                  )}

                  <nav className="location-map-links" aria-label="Open selected location in another map">
                    <a
                      onClick={() => trackEvent('outbound_link', { destination: 'google_maps' })} href={'https://www.google.com/maps/search/?api=1&query=' + selected.lat + ',' + selected.lon}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Maps
                    </a>
                    <span aria-hidden="true">·</span>
                    <a
                      onClick={() => trackEvent('outbound_link', { destination: 'street_view' })} href={'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + selected.lat + ',' + selected.lon}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Street View
                    </a>
                  </nav>
                </section>
              )}

              {data && (
                <div className="event-summary" aria-label="Global eclipse summary">
                  <div>
                    <span>Greatest</span>
                    <strong>{formatTime(data.greatestTime, 'UTC').replace(' UTC', '')}</strong>
                    <small>UTC</small>
                  </div>
                  <div>
                    <span>Global magnitude</span>
                    <strong>{data.magnitude.toFixed(3)}</strong>
                    <small>{percent(data.obscuration)} obscured</small>
                  </div>
                  <div>
                    <span>{data.type === 'partial' ? 'Saros series' : data.type === 'annular' ? 'Annularity' : 'Totality'}</span>
                    <strong>{data.type === 'partial' ? data.saros : formatDuration(data.centralDurationSeconds, true)}</strong>
                    <small>{data.type === 'partial' ? 'Global partial eclipse' : 'Saros ' + data.saros}</small>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      <div className="map-tools" aria-label="Map tools">
        <button
          className={drawer === 'layers' ? 'square-button active' : 'square-button'}
          type="button"
          onClick={() => setDrawer(drawer === 'layers' ? null : 'layers')}
          aria-label="Map layers"
        >
          <Layers3 size={19} aria-hidden="true" />
        </button>
        <button
          className={tracking ? 'square-button active tracking' : 'square-button'}
          type="button"
          onClick={startLocationTracking}
          aria-label={tracking ? 'Finding your location' : 'Use my location'}
          disabled={tracking}
        >
          <LocateFixed size={19} aria-hidden="true" />
        </button>
        <button
          className="square-button"
          type="button"
          onClick={() => { trackEvent('map_fit'); if (data && mapRef.current) fitEclipse(mapRef.current, data, window.innerWidth > 760 ? 410 : 0); }}
          aria-label="Fit eclipse path"
        >
          <Globe2 size={19} aria-hidden="true" />
        </button>
      </div>

      <div className="map-legend" aria-label="Visible map layers">
        {layers.path && !!data?.geometry.umbra.length && (
          <span><i className="legend-swatch path" />{data?.type === 'annular' ? 'Annularity' : 'Central path'}</span>
        )}
        {layers.center && !!data?.geometry.centralLine.length && (
          <span><i className="legend-swatch center" />Center line</span>
        )}
        {layers.partial && !!data?.geometry.penumbra.length && (
          <span><i className="legend-swatch partial" />Partial visibility</span>
        )}
        {layers.shadow && <span><i className="legend-swatch shadow" />Moving shadow</span>}
        {!!maximumViewLine.length && <span><i className="legend-swatch direction" />Look toward maximum</span>}
      </div>

      {data && (
        <section className="timeline-dock" aria-label="Eclipse timeline">
          <button
            className={playing ? 'play-button playing' : 'play-button'}
            type="button"
            onClick={togglePlayback}
            aria-label={playing ? 'Pause animation' : 'Play animation'}
            aria-pressed={playing}
          >
            {playing ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
            <span className="play-text">{playing ? 'Pause' : 'Play'}</span>
          </button>
          <div className="timeline-now">
            <strong>{formatTime(new Date(timeMs || data.greatestTime), displayZone).replace(/ [A-Z+].*$/, '')}</strong>
            <span className="timeline-context">
              <span>{timelineStatus}</span>
              <span className="timeline-zone"> · {displayZone === 'UTC' ? 'UTC' : displayZone.split('/').at(-1)?.replaceAll('_', ' ')}</span>
            </span>
          </div>
          <div className="timeline-range">
            <input
              type="range"
              min={timelineBounds.start}
              max={timelineBounds.end}
              step={60_000}
              value={Math.max(timelineBounds.start, Math.min(timelineBounds.end, timeMs || timelineBounds.start))}
              onChange={(event) => {
                setPlaying(false);
                setTimelineIntent('manual');
                trackDebounced('timeline_seek', { source: 'slider', target: 'custom' });
                setTimeMs(Number(event.target.value));
              }}
              aria-label="Eclipse time"
              aria-valuetext={
                formatTime(new Date(timeMs || data.greatestTime), displayZone) + ', ' + timelineStatus.toLowerCase()
              }
              style={{ '--timeline-progress': timelineProgress } as CSSProperties}
            />
            <div className="contact-markers" aria-hidden="true">
              {local?.contacts
                .filter((contact) => contact.key.startsWith('c'))
                .map((contact) => {
                  const left = ((contact.date.getTime() - timelineBounds.start) / (timelineBounds.end - timelineBounds.start)) * 100;
                  return <i key={contact.key} style={{ left: Math.max(0, Math.min(100, left)) + '%' }} />;
                })}
            </div>
            <div className="timeline-labels" aria-hidden="true">
              <span>{local?.contacts.find((contact) => contact.key === 'c1')?.shortLabel ?? 'Start'}</span>
              <span
                className="maximum-label"
                style={{ left: maximumTimelinePercent + '%' }}
              >
                Maximum
              </span>
              <span>{local?.contacts.find((contact) => contact.key === 'c4')?.shortLabel ?? 'End'}</span>
            </div>
          </div>
          <button
            className={
              timelineStatus === (nowAvailable ? 'Now' : 'Maximum')
                ? 'timeline-reset active'
                : 'timeline-reset'
            }
            type="button"
            onClick={() => {
              setPlaying(false);
              trackEvent('timeline_seek', { source: 'reset', target: nowAvailable ? 'now' : 'maximum' });
              if (nowAvailable) {
                setTimelineIntent('now');
                setTimeMs(Date.now());
              } else {
                setTimelineIntent('auto');
                setTimeMs(local?.maximum?.date.getTime() ?? data.greatestTime.getTime());
              }
            }}
            aria-label={nowAvailable ? 'Jump to current time' : 'Jump to maximum eclipse'}
          >
            {nowAvailable ? 'Now' : 'Max'}
          </button>
          <button className="timeline-time-mode" type="button" onClick={() => { const value = timeMode === 'local' ? 'utc' : 'local'; trackEvent('preference_change', { preference: 'clock', value }); setTimeMode(value); }}>
            {timeMode === 'local' && selected ? 'Local' : 'UTC'}
          </button>
        </section>
      )}

      <div className="coordinate-readout">
        <span>Center {formatCoordinate(mapCenter.lat, true)} · {formatCoordinate(mapCenter.lon, false)}</span>
        {cursor && <span className="cursor-coordinates">Cursor {formatCoordinate(cursor.lat, true)} · {formatCoordinate(cursor.lon, false)}</span>}
      </div>

      {contourReadout && (
        <div
          className="contour-readout"
          style={{ left: contourReadout.x + 12, top: contourReadout.y + 12 }}
        >
          <span>{contourReadout.kind}</span>
          <strong>{contourReadout.label}</strong>
        </div>
      )}

      {drawer && (
        <>
          <button className="drawer-scrim" type="button" onClick={() => setDrawer(null)} aria-label="Close panel" />
          <aside
            ref={drawerRef}
            className={'drawer drawer-' + drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby={'drawer-title-' + drawer}
          >
            <div className="drawer-header">
              <div>
                <span>{drawer === 'catalog' ? 'Five millennia' : drawer === 'search' ? 'Places' : drawer === 'layers' ? 'Map' : 'Umbra'}</span>
                <h2 id={'drawer-title-' + drawer} tabIndex={-1} data-drawer-heading>
                  {drawer === 'catalog' ? 'Solar eclipse catalog' : drawer === 'search' ? 'Find a place' : drawer === 'layers' ? 'Layers & view' : 'Advanced & exports'}
                </h2>
              </div>
              <button className="mini-icon" type="button" onClick={() => setDrawer(null)} aria-label="Close panel">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {drawer === 'search' && (
              <div className="drawer-content">
                <form className="place-search-form" onSubmit={submitPlaceSearch}>
                  <Search size={17} aria-hidden="true" />
                  <input
                    value={placeQuery}
                    onChange={(event) => setPlaceQuery(event.target.value)}
                    placeholder="City, region, coordinates"
                    autoFocus
                    aria-label="Place name"
                  />
                  {placeLoading && <span className="tiny-spinner" aria-label="Searching" />}
                </form>
                <details className="coordinate-search" onToggle={(event) => trackEvent('detail_toggle', { section: 'coordinates', open: event.currentTarget.open })}>
                  <summary>Enter coordinates <ChevronDown size={15} aria-hidden="true" /></summary>
                  <form onSubmit={submitCoordinates}>
                    <label>
                      <span>Latitude</span>
                      <input name="latitude" type="number" min="-90" max="90" step="any" defaultValue={mapCenter.lat.toFixed(5)} required />
                    </label>
                    <label>
                      <span>Longitude</span>
                      <input name="longitude" type="number" min="-180" max="180" step="any" defaultValue={mapCenter.lon.toFixed(5)} required />
                    </label>
                    <button type="submit">Use coordinates</button>
                    <button
                      type="button"
                      onClick={() => {
                        choosePoint(mapCenter.lat, mapCenter.lon, 'Selected point', undefined, undefined, 'map_center');
                        setDrawer(null);
                      }}
                    >
                      Use map center
                    </button>
                  </form>
                </details>
                {placeError && <p className="inline-error" role="alert">{placeError}</p>}
                {!!placeResults.length && (
                  <div className="place-list">
                    <span className="list-label">Results</span>
                    {placeResults.map((place) => (
                      <button key={place.id} type="button" onClick={() => choosePlace(place, 'search_result')}>
                        <MapPin size={16} aria-hidden="true" />
                        <span><strong>{place.name}</strong><small>{place.subtitle}</small></span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
                {!!savedPlaces.length && (
                  <div className="place-list saved-list">
                    <span className="list-label">Saved on this device</span>
                    {savedPlaces.map((place, index) => (
                      <button key={place.lat + ':' + place.lon + ':' + index} type="button" onClick={() => choosePlace(place, 'saved')}>
                        <Bookmark size={15} fill="currentColor" aria-hidden="true" />
                        <span><strong>{place.name}</strong><small>{formatCoordinate(place.lat, true)} · {formatCoordinate(place.lon, false)}</small></span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
                {!placeResults.length && !savedPlaces.length && !placeError && (
                  <div className="empty-state compact">
                    <Navigation size={22} aria-hidden="true" />
                    <strong>Search anywhere on Earth</strong>
                    <span>Or close this panel and tap the map directly.</span>
                  </div>
                )}
              </div>
            )}

            {drawer === 'catalog' && (
              <div className="drawer-content catalog-content">
                <div className="year-range">
                  <label><span>From</span><input type="number" min="-1999" max="3000" value={fromYear} onChange={(event) => setFromYear(Number(event.target.value))} /></label>
                  <span>to</span>
                  <label><span>Until</span><input type="number" min="-1999" max="3000" value={toYear} onChange={(event) => setToYear(Number(event.target.value))} /></label>
                </div>
                <div className="type-filters" aria-label="Eclipse types">
                  {ALL_TYPES.map((type) => (
                    <button
                      type="button"
                      key={type}
                      className={typeFilters.includes(type) ? 'active' : ''}
                      aria-pressed={typeFilters.includes(type)}
                      onClick={() =>
                        setTypeFilters((current) =>
                          current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
                        )
                      }
                    >
                      <i style={{ background: colorForType(type) }} />
                      {TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={visibleHere} onChange={(event) => setVisibleHere(event.target.checked)} disabled={!selected} />
                  <span><strong>Visible from my spot</strong><small>{selected ? selected.name : 'Choose a location first'}</small></span>
                </label>
                {visibleHere && (
                  <label className="check-row nested">
                    <input type="checkbox" checked={centralOnly} onChange={(event) => setCentralOnly(event.target.checked)} />
                    <span><strong>Central eclipse only</strong><small>Total or annular at this spot</small></span>
                  </label>
                )}
                <details className="filter-details" onToggle={(event) => trackEvent('detail_toggle', { section: 'catalog_filters', open: event.currentTarget.open })}>
                  <summary><ListFilter size={15} aria-hidden="true" /> More filters <ChevronDown size={15} aria-hidden="true" /></summary>
                  <div className="filter-grid">
                    <label><span>Minimum central phase</span><select value={minDuration} onChange={(event) => setMinDuration(Number(event.target.value))}><option value="0">Any duration</option><option value="1">1 minute</option><option value="3">3 minutes</option><option value="5">5 minutes</option><option value="7">7 minutes</option></select></label>
                    <label><span>Saros series</span><input type="number" value={sarosFilter} onChange={(event) => setSarosFilter(event.target.value)} placeholder="Any" /></label>
                    <label><span>Sort by</span><select value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as typeof catalogSort)}><option value="date">Date</option><option value="duration">Longest</option><option value="magnitude">Magnitude</option></select></label>
                  </div>
                </details>
                <button className="catalog-search-button" type="button" onClick={runCatalogSearch} disabled={catalogLoading} data-catalog-search>
                  {catalogLoading ? 'Searching ' + Math.round(catalogProgress * 100) + '%' : 'Search eclipses'}
                </button>
                {catalogError && <p className="inline-error" role="alert">{catalogError}</p>}
                {catalogSearched && (
                  <div className="catalog-results">
                    <div className="results-heading">
                      <span>{catalogResults.length.toLocaleString()} eclipses</span>
                      {comparisonDates.length > 0 && <small>{comparisonDates.length}/3 compared</small>}
                    </div>
                    {catalogResults.slice(0, 300).map((entry) => (
                      <article className={entry.date === eventDate ? 'catalog-card current' : 'catalog-card'} key={entry.date}>
                        <button className="catalog-open" type="button" onClick={() => changeEvent(entry.date)}>
                          <i style={{ background: colorForType(entry.type) }} />
                          <span>
                            <strong>{formatDateLabel(entry.date)}</strong>
                            <small>{TYPE_LABELS[entry.type]} · Saros {entry.saros}</small>
                          </span>
                          <span className="catalog-metric">
                            {entry.type === 'partial' ? entry.magnitude.toFixed(3) : formatDuration(entry.durationSeconds, true)}
                          </span>
                        </button>
                        <button
                          className={comparisonDates.includes(entry.date) ? 'compare-button active' : 'compare-button'}
                          type="button"
                          onClick={() => toggleComparison(entry.date)}
                          aria-pressed={comparisonDates.includes(entry.date)}
                        >
                          {comparisonDates.includes(entry.date) ? <Check size={13} /> : <span />}
                          Compare
                        </button>
                      </article>
                    ))}
                    {catalogResults.length > 300 && <p className="result-limit">Showing the first 300. Narrow the range to see more.</p>}
                    {!catalogResults.length && <div className="empty-state compact"><Moon size={22} /><strong>No matching eclipses</strong><span>Widen the years or remove a filter.</span></div>}
                  </div>
                )}
              </div>
            )}

            {drawer === 'layers' && (
              <div className="drawer-content">
                <section className="settings-section">
                  <span className="list-label">Map setup</span>
                  <div className="layer-presets" aria-label="Layer presets">
                    {LAYER_PRESET_LABELS.map((preset) => (
                      <button
                        className={activeLayerPreset === preset.id ? 'active' : ''}
                        type="button"
                        key={preset.id}
                        onClick={() => applyLayerPreset(preset.id)}
                        aria-pressed={activeLayerPreset === preset.id}
                      >
                        <strong>{preset.label}</strong>
                        <small>{preset.detail}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="settings-section">
                  <span className="list-label">Base map</span>
                  <div className="base-map-grid">
                    {BASE_LABELS.map((item) => (
                      <button className={baseMap === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => { trackEvent('map_style', { style: item.id }); setBaseMap(item.id); }} aria-pressed={baseMap === item.id}>
                        <span className={'base-preview preview-' + item.id} />
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                        {baseMap === item.id && <Check size={15} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                </section>
                <details className="layer-details" onToggle={(event) => trackEvent('detail_toggle', { section: 'layers', open: event.currentTarget.open })}>
                  <summary>Individual layers <ChevronDown size={15} aria-hidden="true" /></summary>
                  <section className="settings-subsection">
                    <span className="list-label">Essential</span>
                    <ToggleRow label="Central path & limits" detail="Total, annular, or hybrid band" color={eventColor} checked={layers.path} onChange={(value) => setLayer('path', value)} />
                    <ToggleRow label="Center line" detail="Maximum duration along the path" color={eventColor} checked={layers.center} onChange={(value) => setLayer('center', value)} />
                    <ToggleRow label="Partial visibility" detail="Penumbra footprint" color="#536D74" checked={layers.partial} onChange={(value) => setLayer('partial', value)} />
                    <ToggleRow label="Moving shadow" detail="Follows the timeline" color="#102630" checked={layers.shadow} onChange={(value) => setLayer('shadow', value)} />
                  </section>
                  <section className="settings-subsection">
                    <span className="list-label">Planning</span>
                    <ToggleRow label="Sunrise & sunset limits" detail="Low-horizon boundaries" color="#536D74" checked={layers.horizons} onChange={(value) => setLayer('horizons', value)} />
                    <ToggleRow label="10-minute path ticks" detail="Timing guides across the center line" color="#536D74" checked={layers.guides} onChange={(value) => setLayer('guides', value)} />
                    <ToggleRow label="Day, twilight & night" detail="Civil, nautical, astronomical" color="#536D74" checked={layers.night} onChange={(value) => setLayer('night', value)} />
                    <ToggleRow label="Night lights" detail="NASA Earth at Night" color="#536D74" checked={layers.lightPollution} onChange={(value) => setLayer('lightPollution', value)} />
                    {layers.lightPollution && (
                      <label className="opacity-row"><span>Overlay strength</span><input type="range" min="0.15" max="0.95" step="0.05" value={nightOpacity} onChange={(event) => { trackDebounced('layer_opacity', { opacity: Number(event.target.value) }); setNightOpacity(Number(event.target.value)); }} /></label>
                    )}
                  </section>
                  <section className="settings-subsection">
                    <span className="list-label">Analysis</span>
                    <ToggleRow label="Magnitude contours" detail="Approximate planning lines in 0.2 steps" color="#536D74" checked={layers.magnitude} onChange={(value) => setLayer('magnitude', value)} />
                    <ToggleRow label="Maximum-time contours" detail="Approximate local maximum every 30 min" color="#536D74" checked={layers.timeContours} onChange={(value) => setLayer('timeContours', value)} />
                  </section>
                </details>
                {(layers.magnitude || layers.timeContours) && (
                  <p className="contour-note">
                    Hover a contour to read its value. These 2° planning contours are approximate; use point calculations for exact local circumstances.
                  </p>
                )}
                <p className="map-hint">Tap for local circumstances · right-click to center and zoom · Shift-drag for box zoom.</p>
              </div>
            )}

            {drawer === 'more' && (
              <div className="drawer-content">
                <section className="action-section">
                  <span className="list-label">This view</span>
                  <div className="action-grid">
                    <button type="button" onClick={shareView}><Share2 size={17} /><span>Share link</span></button>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          '<iframe title="Umbra eclipse map" src="' +
                            window.location.href +
                            '" width="100%" height="600" loading="lazy"></iframe>',
                          'Embed code copied',
                        )
                      }
                    >
                      <Clipboard size={17} /><span>Copy embed</span>
                    </button>
                    <button type="button" onClick={() => exportData('ics')}><CalendarDays size={17} /><span>Calendar</span></button>
                    <button type="button" onClick={enterPresentation}><Presentation size={17} /><span>Present map</span></button>
                  </div>
                </section>
                <section className="action-section">
                  <span className="list-label">Download path data</span>
                  <div className="download-list">
                    <button type="button" onClick={() => exportData('geojson')}><FileDown size={16} /><span><strong>GeoJSON</strong><small>Map software & code</small></span></button>
                    <button type="button" onClick={() => exportData('kml')}><Globe2 size={16} /><span><strong>KML</strong><small>Google Earth</small></span></button>
                    <button type="button" onClick={() => exportData('kmz')}><Globe2 size={16} /><span><strong>KMZ</strong><small>Compressed Google Earth</small></span></button>
                    <button type="button" onClick={() => exportData('gpx')}><Route size={16} /><span><strong>GPX</strong><small>Center-line track</small></span></button>
                    <button type="button" onClick={() => exportData('csv')}><Download size={16} /><span><strong>Local CSV</strong><small>Contacts & sky angles</small></span></button>
                  </div>
                </section>
                <section className="action-section settings-inline">
                  <span className="list-label">Preferences</span>
                  <div className="preference-row"><span>Distance</span><div className="segmented"><button type="button" className={distanceUnit === 'metric' ? 'active' : ''} aria-pressed={distanceUnit === 'metric'} onClick={() => { trackEvent('preference_change', { preference: 'distance', value: 'metric' }); setDistanceUnit('metric'); }}>km</button><button type="button" className={distanceUnit === 'imperial' ? 'active' : ''} aria-pressed={distanceUnit === 'imperial'} onClick={() => { trackEvent('preference_change', { preference: 'distance', value: 'imperial' }); setDistanceUnit('imperial'); }}>mi</button></div></div>
                  <div className="preference-row"><span>Clock</span><div className="segmented"><button type="button" className={timeMode === 'local' ? 'active' : ''} aria-pressed={timeMode === 'local'} onClick={() => { trackEvent('preference_change', { preference: 'clock', value: 'local' }); setTimeMode('local'); }}>Local</button><button type="button" className={timeMode === 'utc' ? 'active' : ''} aria-pressed={timeMode === 'utc'} onClick={() => { trackEvent('preference_change', { preference: 'clock', value: 'utc' }); setTimeMode('utc'); }}>UTC</button></div></div>
                </section>
                <details className="about-details map-summary-details" onToggle={(event) => trackEvent('detail_toggle', { section: 'text_summary', open: event.currentTarget.open })}>
                  <summary><Accessibility size={16} /> Text map summary <ChevronDown size={15} /></summary>
                  <div>
                    <p>{mapSummary}</p>
                    <p>
                      Active layers: {[
                        layers.partial && 'partial visibility',
                        layers.path && 'central path',
                        layers.center && 'center line',
                        layers.shadow && 'moving shadow',
                        layers.night && 'day and twilight',
                        layers.magnitude && 'magnitude contours',
                        layers.timeContours && 'maximum-time contours',
                      ].filter(Boolean).join(', ') || 'base map only'}.
                    </p>
                  </div>
                </details>
                <details className="about-details" onToggle={(event) => trackEvent('detail_toggle', { section: 'about', open: event.currentTarget.open })}>
                  <summary><Info size={16} /> About the calculations <ChevronDown size={15} /></summary>
                  <div>
                    <p>Predictions use Besselian elements from NASA’s Five Millennium Canon and astronomy-bundle 9.38.0. Coordinates use WGS84; times can be shown in UTC or the selected IANA time zone.</p>
                    <p>Map paths are sampled about every 20 seconds. Analysis contours use a 2° grid and 30-minute time intervals. Horizon checks build a 90° terrain skyline from an elevation model; they do not include buildings or vegetation.</p>
                    <p>Magnitude measures the fraction of the Sun’s diameter covered; obscuration measures its area. C1/C4 mark the partial phase, and C2/C3 bound totality or annularity. Umbra is the central shadow; penumbra is the partial shadow.</p>
                    <p>Small differences are expected from atmospheric refraction, terrain, ΔT, and the Moon’s irregular limb. Verify critical plans with an official source.</p>
                    <p className="safety-note"><Sun size={16} /> Use certified eclipse glasses whenever any bright part of the Sun is visible. Ordinary sunglasses are not safe.</p>
                    <div className="source-links">
                      <a onClick={() => trackEvent('outbound_link', { destination: 'nasa' })} href="https://eclipse.gsfc.nasa.gov/SEcat5/SEcatalog.html" target="_blank" rel="noreferrer">NASA eclipse catalog <ExternalLink size={13} /></a>
                      <a onClick={() => trackEvent('outbound_link', { destination: 'astronomy_bundle' })} href="https://github.com/andrmoel/astronomy-bundle-js" target="_blank" rel="noreferrer">Calculation library <ExternalLink size={13} /></a>
                      <a onClick={() => trackEvent('outbound_link', { destination: 'open_meteo' })} href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noreferrer">Terrain: Open-Meteo / Copernicus DEM <ExternalLink size={13} /></a>
                      <a onClick={() => trackEvent('outbound_link', { destination: 'openstreetmap' })} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map attributions <ExternalLink size={13} /></a>
                    </div>
                  </div>
                </details>
                <p className="credits">Eclipse predictions by Fred Espenak and Jean Meeus (NASA’s GSFC). Built as an independent clean-room explorer.</p>
              </div>
            )}
          </aside>
        </>
      )}

      {loading && (
        <div className="loading-pill" role="status">
          <span className="tiny-spinner" />
          Calculating eclipse path
        </div>
      )}
      <div className={toast ? 'toast visible' : 'toast'} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}

function LocationComparison({
  items,
  selected,
  bestKey,
  timeMode,
  onChoose,
}: {
  items: LocationComparisonItem[];
  selected: SelectedLocation;
  bestKey?: string;
  timeMode: TimeMode;
  onChoose: (place: SelectedLocation) => void;
}) {
  if (items.length < 2) return null;
  return (
    <details className="place-comparison" onToggle={(event) => trackEvent('detail_toggle', { section: 'location_comparison', open: event.currentTarget.open })}>
      <summary>
        Compare {items.length} locations
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="comparison-list">
        {items.map((item) => {
          const itemObservability = observability(item.result);
          const itemZone = timeMode === 'local' ? item.zone : 'UTC';
          const isActive = locationKey(selected) === item.key;
          return (
            <button
              type="button"
              className={
                'comparison-card' +
                (isActive ? ' active' : '') +
                (item.key === bestKey ? ' highest-coverage' : '')
              }
              key={item.key}
              onClick={() => onChoose(item.place)}
              aria-current={isActive ? 'location' : undefined}
            >
              <span className="comparison-place">
                <strong>{item.place.name}</strong>
                <small>{typeSentence(item.result.type, itemObservability)}</small>
              </span>
              {item.key === bestKey && <span className="comparison-badge">Highest coverage</span>}
              <span className="comparison-metric">
                <small>Covered</small>
                <strong>{item.result.type === 'none' ? '—' : percent(item.result.obscuration)}</strong>
              </span>
              <span className="comparison-metric">
                <small>Maximum</small>
                <strong>
                  {item.result.maximum
                    ? formatTime(item.result.maximum.date, itemZone).replace(/ [A-Z+].*$/, '')
                    : '—'}
                </strong>
              </span>
              <span className="comparison-metric">
                <small>Sun</small>
                <strong>
                  {item.result.maximum
                    ? item.result.maximum.altitude.toFixed(1) + '° ' +
                      compassDirection(item.result.maximum.azimuth)
                    : '—'}
                </strong>
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

function UpcomingEclipseRow({
  item,
  kind,
  onOpen,
}: {
  item: UpcomingLocalEclipse;
  kind: 'total' | 'partial';
  onOpen: (date: string) => void;
}) {
  const detail =
    kind === 'total'
      ? `${formatDuration(item.durationSeconds, true)} totality · Sun ${item.altitude.toFixed(0)}° high`
      : `${percent(item.obscuration)} covered · Sun ${item.altitude.toFixed(0)}° high`;

  return (
    <button
      type="button"
      className="upcoming-eclipse-row"
      onClick={() => onOpen(item.date)}
      aria-label={`Open the ${formatDateLabel(item.date)} eclipse`}
    >
      <span>
        <strong>{formatDateLabel(item.date)}</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
  );
}

function UpcomingEclipsesPanel({
  results,
  loading,
  error,
  afterDate,
  onOpen,
  onBrowse,
}: {
  results: UpcomingLocalEclipses | null;
  loading: boolean;
  error: string;
  afterDate: string;
  onOpen: (date: string) => void;
  onBrowse: () => void;
}) {
  return (
    <section className="upcoming-eclipses" aria-labelledby="upcoming-eclipses-title">
      <div className="upcoming-eclipses-heading">
        <h3 id="upcoming-eclipses-title">Next eclipses here</h3>
        <small>after {formatDateLabel(afterDate)}</small>
      </div>

      {loading && (
        <div className="upcoming-eclipses-loading" role="status">
          <span>Looking ahead</span>
          <i /><i /><i />
        </div>
      )}

      {!loading && error && <p className="upcoming-eclipses-error">{error}</p>}

      {!loading && !error && results && (
        <>
          <div className="upcoming-eclipse-group">
            <span className="upcoming-eclipse-label">Next total eclipses</span>
            {results.totals.length ? (
              results.totals.map((item) => (
                <UpcomingEclipseRow key={item.date} item={item} kind="total" onOpen={onOpen} />
              ))
            ) : (
              <p className="upcoming-eclipses-empty">
                No total eclipse at this point before {results.throughYear}.
              </p>
            )}
          </div>

          <details className="upcoming-partials" onToggle={(event) => trackEvent('detail_toggle', { section: 'upcoming_partials', open: event.currentTarget.open })}>
            <summary>
              <span>Next partial eclipses</span>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div>
              {results.partials.length ? (
                results.partials.map((item) => (
                  <UpcomingEclipseRow key={item.date} item={item} kind="partial" onOpen={onOpen} />
                ))
              ) : (
                <p className="upcoming-eclipses-empty">
                  No partial eclipse at this point before {results.throughYear}.
                </p>
              )}
            </div>
          </details>

          <button type="button" className="upcoming-eclipses-browse" onClick={onBrowse}>
            Browse the next 100 years
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  );
}

function ToggleRow({
  label,
  detail,
  color,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  color: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <i style={{ background: color }} />
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <b aria-hidden="true"><span /></b>
    </label>
  );
}

function HorizonCard({
  profile,
  sunAltitude,
}: {
  profile: HorizonProfile;
  sunAltitude: number;
}) {
  const width = 360;
  const height = 124;
  const plotTop = 8;
  const plotBottom = 96;
  const angles = profile.skyline.map((sample) => sample.apparentAngle);
  const min = Math.min(-2, Math.floor(Math.min(...angles) - 1));
  const max = Math.max(
    5,
    Math.ceil(sunAltitude + 1),
    Math.ceil(Math.max(...angles) + 1),
  );
  const y = (value: number) =>
    plotBottom - ((value - min) / Math.max(0.1, max - min)) * (plotBottom - plotTop);
  const skylinePoints = profile.skyline
    .map((sample, index) => {
      const x = (index / (profile.skyline.length - 1)) * width;
      return x.toFixed(1) + ',' + y(sample.apparentAngle).toFixed(1);
    })
    .join(' ');
  const terrainFill = `0,${plotBottom} ${skylinePoints} ${width},${plotBottom}`;
  const normalizeBearing = (value: number) => ((value % 360) + 360) % 360;
  const leftBearing = normalizeBearing(profile.bearing - profile.fieldOfView / 2);
  const rightBearing = normalizeBearing(profile.bearing + profile.fieldOfView / 2);
  const sunY = y(sunAltitude);
  const sunLabelY = sunY < 22 ? sunY + 16 : sunY - 8;
  return (
    <div
      className={profile.obstructed ? 'horizon-card obstructed' : 'horizon-card clear'}
      aria-live="polite"
    >
      <div className="horizon-heading">
        <span>Terrain skyline · facing {Math.round(profile.bearing)}° {compassDirection(profile.bearing)}</span>
        <strong>
          {profile.obstructed
            ? 'Terrain may cover the Sun ahead'
            : `Sun clears terrain ahead by ${profile.clearance.toFixed(1)}°`}
        </strong>
        <small>90° view around maximum · center line is where to look</small>
      </div>
      <svg
        viewBox={'0 0 ' + width + ' ' + height}
        role="img"
        aria-label={`Estimated terrain skyline from ${Math.round(leftBearing)} to ${Math.round(rightBearing)} degrees. The Sun is ${sunAltitude.toFixed(1)} degrees high at ${Math.round(profile.bearing)} degrees.`}
      >
        <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="horizon-zero" />
        <polygon points={terrainFill} className="terrain-fill" />
        <polyline points={skylinePoints} className="terrain-line" />
        <line x1={width / 2} x2={width / 2} y1={plotTop} y2={plotBottom} className="view-axis" />
        <circle cx={width / 2} cy={sunY} r="8" className="sun-halo" />
        <circle cx={width / 2} cy={sunY} r="4.5" className="sun-marker" />
        <text x={width / 2 + 10} y={sunLabelY} className="sun-label">Sun {sunAltitude.toFixed(1)}°</text>
        <text x="3" y={Math.max(plotTop + 9, y(0) - 4)} className="horizon-label">0° horizon</text>
        <text x="0" y="118" textAnchor="start" className="bearing-label">
          {Math.round(leftBearing)}° {compassDirection(leftBearing)}
        </text>
        <text x={width / 2} y="118" textAnchor="middle" className="bearing-label active">
          {Math.round(profile.bearing)}° {compassDirection(profile.bearing)}
        </text>
        <text x={width} y="118" textAnchor="end" className="bearing-label">
          {Math.round(rightBearing)}° {compassDirection(rightBearing)}
        </text>
      </svg>
      <dl className="horizon-metrics">
        <div><dt>Sun</dt><dd>{sunAltitude.toFixed(1)}°</dd></div>
        <div><dt>Terrain ahead</dt><dd>{profile.maxTerrainAngle.toFixed(1)}°</dd></div>
        <div><dt>Scan range</dt><dd>{Math.round(profile.distanceKm)} km</dd></div>
      </dl>
      <p>Terrain-model estimate; trees, buildings and peak names are not included.</p>
    </div>
  );
}
