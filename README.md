# StormRoute

Map-based field app for roofing sales: storm swaths (Swath API), owner info (Regrid parcels), JobNimbus jobs on the map, lasso → optimized knocking routes, lasso → direct-mail lists, door → JobNimbus inspection creation, Street View + roof model (Google Solar) on every owner card.

```
packages/shared   TypeScript types, point-in-polygon, route solver, street scoring  (used by all three apps)
apps/api          Fastify + Postgres/PostGIS + Redis/BullMQ. Holds every third-party key; caches paid lookups.
apps/web          React + Google Maps JavaScript API. Managers/admins: polygon lasso, routes, mail lists, Ride the Swath.
apps/mobile       Expo React Native + react-native-maps (Google). Reps: map, owner card, dispositions, inspection → JobNimbus, offline outbox.
```

## Google Maps Platform setup

Everything map-related runs on Google. Create **one Cloud project**, enable billing, then make four restricted API keys:

| Key | Env var | Restrict by | Enable these APIs |
| --- | --- | --- | --- |
| Server | `GOOGLE_MAPS_SERVER_KEY` | IP address of the API host | Geocoding API, Routes API, Solar API, Street View Static API, Places API (New) |
| Browser | `VITE_GOOGLE_MAPS_BROWSER_KEY` | HTTP referrers (your web origin) | Maps JavaScript API |
| Android | `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Android app (package + SHA-1) | Maps SDK for Android |
| iOS | `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` | iOS app (bundle id) | Maps SDK for iOS |

Also:
- **Map ID** (`VITE_GOOGLE_MAP_ID`): Cloud Console → Map Management → create a *JavaScript / Vector* map. Needed for Advanced Markers. `DEMO_MAP_ID` works for development.
- **Street View signing secret** (`GOOGLE_STREETVIEW_SIGNING_SECRET`, optional but recommended): Credentials → *URL signing secret*.
- **Route Optimization API** (`GOOGLE_CLOUD_PROJECT` + `GOOGLE_APPLICATION_CREDENTIALS`, optional): only used for routes with more than 25 stops. It does **not** accept API keys — create a service account with `roles/routeoptimization.editor`, download its JSON, and point `GOOGLE_APPLICATION_CREDENTIALS` at it. Without it, large routes are ordered by the local solver and still drawn with Routes API road geometry.

Never commit `.env`. If a key leaks, rotate it in Credentials immediately.

### What each Google API does here

| API | Used for | Where | Cached? |
| --- | --- | --- | --- |
| Geocoding | JobNimbus contact/job addresses → pins | `workers/jobnimbus-sync.ts` via `integrations/geocode.ts` | yes, `geocode_cache` (forever, incl. misses) |
| Routes (`computeRoutes`) | Road-accurate knocking routes, TSP order for ≤ 25 stops | `routes/routes.ts` | no (per request) |
| Route Optimization (`optimizeTours`) | TSP order for > 25 stops | `routes/routes.ts` | no |
| Solar (`buildingInsights`) | Roof area / pitch / facets / imagery date on the owner card | `routes/parcels.ts` `ensureRoof` | yes, `parcel_roofs` (once per parcel, misses too) |
| Street View Static + metadata | House photo on the owner card, proxied through `/v1/parcels/:id/streetview` | `routes/parcels.ts` | availability stamped on `parcels`; image cached client-side for a day |
| Places (New) autocomplete + details | Address search box | `routes/places.ts` | no (session-token billed) |
| Maps JavaScript / SDKs | The maps | `apps/web`, `apps/mobile` | — |

Per-company spend by endpoint/day is in `api_usage` (`GET /v1/admin/usage`).

## Run it

```bash
cp .env.example .env            # fill in tokens; JWT_SECRET and KEY_ENCRYPTION_KEY: openssl rand -base64 32
npm install
npm run db:up                   # PostGIS + Redis via docker compose
npm run db:migrate
npm run dev:api                 # http://localhost:4000  (refuses to start with a readable error if .env is incomplete)
npm -w apps/api run worker      # JobNimbus reconcile, inspection outbox, storm refresh
npm run dev:web                 # http://localhost:5173
npm run dev:mobile              # Expo dev client (needs a native build: npx expo run:ios / run:android)
npm run typecheck && npm test   # all workspaces + unit tests
npm run build                   # api → apps/api/dist (node dist/index.js), web → apps/web/dist
```

Create a company, an admin user and a signed JWT (`{ id, companyId, role }` with `JWT_SECRET`) to call the API; a login route is intentionally left for your auth provider (Clerk/Auth0) to fill in.

## Where the spec lives in the code

| Spec | Code |
| --- | --- |
| F2 owner card, Swath lookup with 90-day cache, Street View, roof model | `apps/api/src/routes/parcels.ts` (`/at`, `ensureStormHistory`, `ensureRoof`, `/:id/streetview`) |
| F3 storm overlay | `routes/storms.ts`, `workers/storm-refresh.ts` |
| F4 JobNimbus pins, webhooks, 15-min reconcile | `workers/jobnimbus-sync.ts`, `routes/webhooks.ts` |
| F5 lasso → route (Google Routes / Route Optimization, local fallback) | `routes/routes.ts`, `integrations/google.ts`, `packages/shared/src/geo.ts` |
| F6 lasso → mail list, dedupe, quote | `routes/mail.ts`, `routes/parcels.ts` (`/within` warms the parcel cache from Regrid) |
| F7 inspection → contact/job/task, duplicate guard | `routes/inspections.ts`, `workers/inspection-outbox.ts` |
| F8 Ride the Swath street ranking | `routes/storms.ts` (`/:id/streets`), `web/components/RideSwath.tsx` |
| F9 roof-age heatmap | `GET /v1/parcels?bbox=` + `web/App.tsx` parcel `DataLayer` ("Roof age" toggle) |
| F10 occupancy split | filters in `LassoPanel.tsx` / `routes/mail.ts` |
| Address search | `routes/places.ts`, `web/components/map/SearchBox.tsx` |
| Offline outbox (dead-letters 4xx rows instead of blocking) | `mobile/src/lib/offlineQueue.ts` |

## Before go-live

- Confirm Swath REST paths and payloads against https://swathapi.com/docs; the client in `integrations/swath.ts` encodes the documented tools (find_storms, lookup_property, get_swath_report, get_report_quote, create_monitor) but exact URLs may differ.
- Confirm the Regrid v2 response shape against one live call (`toParcelRow` in `integrations/regrid.ts` reads attributes from `feature.properties`; v2 may nest them under `properties.fields`).
- Set the JobNimbus custom fields `storm_date`, `hail_size_in`, `swath_storm_id` on the Job record type, and map your inspection status id in company settings.
- Parcel outlines and the roof-age layer come from our own cache (Google Maps has no vector-tile layer). Lassoing a new neighbourhood pulls up to 1,500 parcels from Regrid once; tapping a house pulls one.
- Mobile needs a fresh native build after the Google migration (`npx expo prebuild --clean`, then `expo run:android` / `run:ios`).
