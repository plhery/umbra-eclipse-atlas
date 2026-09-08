# Eclipse Atlas analytics

The public atlas at `umbra-eclipse.plhery.com` sends first-party usage analytics to
[Umami](https://u.plhery.com/websites/bc9f8fd4-11b5-4597-ba36-86232932e930),
using website ID `bc9f8fd4-11b5-4597-ba36-86232932e930` (a public identifier, not a secret).
The server runs in the existing Coolify Umami stack.

## Collection

`components/atlas-analytics.tsx` initializes the official Umami JavaScript SDK;
`lib/analytics.ts` controls when it loads and what it sends. It runs only in a
production build on the public hostname, respects Do Not Track, Global Privacy
Control, and Umami's `localStorage['umami.disabled']` opt-out. Local development,
previews, and builds served on another hostname do not collect analytics.

There is one pageview per atlas load. Updating the map's URL, switching eclipses,
and moving the timeline produce actions rather than additional pageviews.
Requests are serialized so the SDK can reuse its session cache. Early actions
wait in a bounded memory queue. Ad blockers and network failures do not block
product actions. There is no session recording or persistent custom user ID.

Payload URLs are always `/`. Referrers retain only their external origin.
Coordinates, map centers, place names, search text, observer elevation/timezone,
clipboard contents, exported files, and raw errors are never included. Runtime
property allowlists prevent accidental extra fields. Umami still receives the
usual browser/device/language information and derives approximate geography
from the request; no GPS coordinates are sent.

## Action catalogue

| Events | Meaning and properties |
| --- | --- |
| `eclipse_select`, `eclipse_loaded` | Eclipse date, selection source, eclipse type, load duration |
| `panel_view`, `panel_close` | Search, catalogue, layers, or advanced panel |
| `location_select` | Map, coordinates, map center, geolocation, saved location, comparison, search result, shared link |
| `location_request`, `location_result` | Geolocation requested; success, denied, timeout, unavailable, or unsupported |
| `location_save` | Save/remove and resulting count |
| `location_elevation`, `location_timezone` | Observer setting changed, without its value |
| `place_search`, `place_search_result` | Search mode, success/error/invalid outcome and result count; never query text |
| `catalog_search`, `catalog_result` | Submitted year/type/duration/Saros/visibility/sort filters, result count, status, duration |
| `comparison_change` | Add/remove/limit, public eclipse date, number compared |
| `map_ready`, `map_move`, `map_fit`, `map_style`, `map_fullscreen` | Map initialization duration, user movement, rounded zoom, fit, base style, fullscreen state |
| `layer_toggle`, `layer_preset`, `layer_opacity` | Named layer and enabled state, preset, overlay strength |
| `timeline_playback`, `timeline_seek` | Play/pause/completion; slider, keyboard, contact, maximum, or now |
| `presentation`, `sheet_resize` | Presentation mode, mobile sheet size and input method |
| `preference_change`, `detail_toggle` | Clock/distance preference; named expandable section and open state |
| `share`, `copy` | Native/clipboard sharing and embed copying; requested/success/cancelled/error outcomes |
| `export` | GeoJSON, KML, KMZ, GPX, CSV, ICS; requested/success/error/unavailable/needs-location outcomes |
| `outbound_link` | Named map or reference destination, never its location-bearing URL |
| `service_error` | Named failing service and coarse reason; no error message, URL, or stack |

Map movement is throttled to at most one event per 1.5 seconds. Slider and
elevation changes settle for 600 ms before an event is sent. Search filters are
recorded on submission. Automatic map fitting and animation frames do not count
as user movement. `export: success` means the browser download was initiated;
`share: success` means the platform API resolved, not that a recipient opened it.

Use Umami's Events and Event data views for action counts and breakdowns. Filter
`share` and `export` by `status=success` for completed actions; their total event
counts also contain attempts and failures. Tags separate `web`, `pwa`, `ios_web`,
and `ios_pwa`. Browser pageviews, visitors, referrers and devices remain available.

## iOS

Safari and Home Screen web use are covered by the deployed website. There is no
native Eclipse Atlas iOS target or wrapper source in this repository.

A native app can use Umami's unauthenticated `POST /api/send` API for screen views
and the same named events. Prefer a separate Umami website for native iOS,
`tag: ios`, canonical screen paths, and the same property allowlists. Do not embed
an admin credential, IDFA, GPS coordinates, or a persistent user identifier. Send
a valid app User-Agent and retain/reuse the returned `cache` in the
`x-umami-cache` header in memory, serializing requests. Native instrumentation and
an iOS release require that app's source; a web deployment cannot update native
Swift screens.

References: [Umami tracker functions](https://docs.umami.is/docs/tracker-functions),
[tracker configuration](https://docs.umami.is/docs/tracker-configuration),
[sending stats](https://docs.umami.is/docs/api/sending-stats).

## Verification

Run `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`.
Tests cover privacy filtering, disabled/local environments, one-pageview
initialization, delayed/blocked SDKs, session ordering, bounded queues,
throttling/debouncing, and iOS platform tags.
