# Umbra product and design direction

## North star

Umbra is a contemporary observatory field atlas: serious enough for planning, calm enough for a first-time observer, and usable with one hand outdoors. The map is the product. Interface surfaces attach to its edges and reveal detail only when the current task needs it.

The first question is always: **What happens at this place?**

## Visual language

- Cool cartographic paper, graphite ink, one solar-red eclipse accent, and blue only for a selected location.
- IBM Plex Sans for reading, IBM Plex Mono for measurements, and Barlow Condensed for short factual event titles.
- One flat inspector rail on desktop; one bottom sheet with meaningful snap states on mobile.
- Lines, weight, and dash patterns communicate map meaning before color does.
- Attached panels have no shadow. Only temporary map controls may float.
- Functional type is at least 12px, common controls are at least 44px, and times use tabular numerals.
- Avoid decorative eyebrow copy, lifestyle headlines, nested cards, placeholder swatches, glowing gradients, and repeated rounded containers.

## Personas and journeys

### 1. Curious visitor or first-time observer

**Question:** What is this eclipse, where does it cross, and can I see it?

Journey: open the next eclipse → understand type/date/route → search or use current location → read a plain visibility verdict → inspect maximum time and coverage → learn eye-safety basics.

Design response: a factual event heading, a simple default map, a prominent location check, and an immediate local verdict.

### 2. Local visibility checker

**Question:** What happens at my home, school, or city?

Journey: enter a place → receive type, coverage, maximum time, and duration → switch local/UTC if needed → share the exact result.

Design response: local circumstances appear before global statistics; the mobile peek becomes the result instead of hiding it.

### 3. Day-of mobile observer

**Question:** What happens next, and where should I look?

Journey: reopen a shared/saved place → see the verdict and current time → play or scrub the shadow → tap contact times → read altitude and compass direction → keep the map visible outdoors.

Design response: a compact persistent timeline, large touch targets, high-contrast type, safe-area spacing, and no dependency on hover.

### 4. Eclipse traveler or group organizer

**Question:** Is this site worth traveling to, and can I coordinate it?

Journey: inspect the path → choose a place → check distance to center/edge and terrain horizon → save the place → add the event to a calendar → share the exact view.

Design response: the Plan map preset, automatic horizon sampling, saved places, and result-adjacent calendar/share actions.

### 5. Photographer or field operator

**Question:** What are the precise timing and sky geometry at my setup?

Journey: select coordinates/elevation → review contacts → inspect Sun altitude, azimuth, and terrain skyline → export a local CSV.

Design response: exact measurements and the automatic terrain skyline remain available in Planning details, while the main verdict stays uncluttered.

### 6. Educator, student, or science communicator

**Question:** How does the Moon's shadow move, and why does visibility differ by place?

Journey: select an event → use the Explain preset → play the shadow → switch between locations → show daylight/twilight context → share an embeddable view.

Design response: an explicitly labeled Play control, direct time scrubbing, and an Explain preset that adds only the relevant teaching layers.

### 7. Researcher, GIS user, or serious amateur

**Question:** What is the underlying geometry, and can I use the data elsewhere?

Journey: browse/filter the five-millennium catalog → compare eclipses → enable contour layers → inspect UTC precision and provenance → export GeoJSON, KML/KMZ, GPX, or CSV.

Design response: Analyze is a deliberate preset; catalog filters, calculation notes, and exports live under advanced controls rather than competing with the core journey.

### 8. Accessibility and constrained-context user

**Question:** Can I read and operate this reliably with zoom, keyboard, reduced motion, glare, or limited dexterity?

Journey: keyboard through semantic controls → identify map layers without color alone → zoom text → use 44px targets → pause animation → read the same result without hover.

Design response: visible focus, semantic buttons and labels, restrained motion, larger functional text, line-style redundancy, and sunlight-readable contrast.

## Information priority

1. Selected event: type, date, route.
2. Choose a location or show the selected-location verdict.
3. Local maximum time, coverage, duration, altitude, and direction.
4. The map and moving-shadow timeline.
5. Planning actions and terrain/horizon detail.
6. Global eclipse statistics.
7. Scientific layers, provenance, comparisons, and exports.

## Layer presets

- **Simple:** central path, center line, partial boundary, moving shadow.
- **Plan:** Simple plus horizon limits and 10-minute path ticks.
- **Explain:** Simple plus timing guides and daylight/twilight zones.
- **Analyze:** geometry, horizon/timing guides, magnitude contours, and maximum-time contours without the live shadow.

These presets describe user intent. Individual implementation layers remain available as progressive disclosure.
