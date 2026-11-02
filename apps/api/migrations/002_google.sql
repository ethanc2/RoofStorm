-- Google Maps Platform caches. Everything here is paid once and reused.

-- Solar API buildingInsights per parcel (imagery changes rarely; fetched once, refreshed only on demand)
CREATE TABLE parcel_roofs (
  parcel_id uuid PRIMARY KEY REFERENCES parcels(id) ON DELETE CASCADE,
  building_id text, roof_area_m2 numeric, roof_area_sqft numeric, segment_count int, pitch_deg numeric, dominant_azimuth_deg numeric,
  imagery_date date, imagery_quality text, segments jsonb NOT NULL DEFAULT '[]'::jsonb, raw jsonb,
  found boolean NOT NULL DEFAULT true, fetched_at timestamptz NOT NULL DEFAULT now());

-- Street View availability per parcel (metadata call is free, but we still avoid hammering it)
ALTER TABLE parcels ADD COLUMN streetview_pano_id text, ADD COLUMN streetview_checked_at timestamptz, ADD COLUMN google_place_id text;

-- Geocoding cache keyed on the normalized address so JobNimbus reconciles never re-bill
CREATE TABLE geocode_cache (
  address_norm text PRIMARY KEY, lng double precision, lat double precision, place_id text, formatted text, location_type text,
  fetched_at timestamptz NOT NULL DEFAULT now());

-- Swath lookup stamp: avoid re-paying when a lookup returned no matching storm events (review finding #9)
ALTER TABLE parcels ADD COLUMN swath_checked_at timestamptz;

CREATE INDEX parcel_storm_events_storm ON parcel_storm_events (storm_id);
