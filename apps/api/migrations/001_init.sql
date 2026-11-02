CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  jobnimbus_api_key_enc bytea, swath_api_key_enc bytea, regrid_token_enc bytea,
  jobnimbus_webhook_secret text, settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL CHECK (role IN ('rep','manager','admin')),
  jobnimbus_user_id text, push_token text, password_hash text, created_at timestamptz DEFAULT now());

CREATE TABLE territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL, geom geometry(Polygon,4326) NOT NULL, assigned_user_ids uuid[] DEFAULT '{}', swath_monitor_id text);
CREATE INDEX territories_geom ON territories USING GIST (geom);

CREATE TABLE parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  source text NOT NULL, source_id text NOT NULL, geom geometry(Polygon,4326), centroid geometry(Point,4326) NOT NULL,
  site_address text, city text, state text, zip text, owner_name text, mailing_address text, owner_occupied boolean,
  year_built int, assessed_value numeric, fetched_at timestamptz DEFAULT now(), UNIQUE (company_id, source, source_id));
CREATE INDEX parcels_centroid ON parcels USING GIST (centroid);
CREATE INDEX parcels_geom ON parcels USING GIST (geom);

CREATE TABLE storms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  swath_storm_id text NOT NULL, event_date date NOT NULL, kind text NOT NULL CHECK (kind IN ('hail','wind')),
  max_hail_in numeric, mean_hail_in numeric, max_gust_mph numeric, geom geometry(MultiPolygon,4326) NOT NULL,
  fetched_at timestamptz DEFAULT now(), UNIQUE (company_id, swath_storm_id));
CREATE INDEX storms_geom ON storms USING GIST (geom);

CREATE TABLE parcel_storm_events (
  parcel_id uuid REFERENCES parcels(id) ON DELETE CASCADE, storm_id uuid REFERENCES storms(id) ON DELETE CASCADE,
  hail_in numeric, gust_mph numeric, source text NOT NULL, PRIMARY KEY (parcel_id, storm_id));

CREATE TABLE knocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  parcel_id uuid REFERENCES parcels(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id),
  disposition text NOT NULL CHECK (disposition IN ('not_home','not_interested','callback','inspection_set','do_not_knock')),
  note text, callback_at timestamptz, photo_urls text[] DEFAULT '{}', client_id uuid UNIQUE NOT NULL, created_at timestamptz DEFAULT now());
CREATE INDEX knocks_parcel ON knocks (parcel_id, created_at DESC);

CREATE TABLE jn_contacts (
  jnid text NOT NULL, company_id uuid REFERENCES companies(id) ON DELETE CASCADE, display_name text, first_name text, last_name text,
  phone text, email text, address_line1 text, city text, state text, zip text, geom geometry(Point,4326),
  status_id int, status_name text, sales_rep text, date_updated timestamptz, raw jsonb, PRIMARY KEY (company_id, jnid));
CREATE INDEX jn_contacts_geom ON jn_contacts USING GIST (geom);

CREATE TABLE jn_jobs (
  jnid text NOT NULL, company_id uuid REFERENCES companies(id) ON DELETE CASCADE, contact_jnid text, name text, record_type text,
  status_id int, status_name text, sales_rep text, address_line1 text, city text, state text, zip text, geom geometry(Point,4326),
  date_created timestamptz, date_updated timestamptz, raw jsonb, PRIMARY KEY (company_id, jnid));
CREATE INDEX jn_jobs_geom ON jn_jobs USING GIST (geom);
CREATE INDEX jn_jobs_updated ON jn_jobs (company_id, date_updated DESC);

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  knock_id uuid REFERENCES knocks(id), parcel_id uuid REFERENCES parcels(id), user_id uuid REFERENCES users(id),
  client_id uuid UNIQUE NOT NULL, contact_jnid text, job_jnid text, task_jnid text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','created','failed')), payload jsonb NOT NULL, error text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id),
  name text NOT NULL, polygon geometry(Polygon,4326), start_pt geometry(Point,4326), end_pt geometry(Point,4326),
  mode text NOT NULL, total_m numeric, total_s numeric, stops jsonb NOT NULL, created_at timestamptz DEFAULT now());

CREATE TABLE mail_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id),
  name text NOT NULL, polygon geometry(Polygon,4326) NOT NULL, filters jsonb NOT NULL, row_count int, csv text,
  swath_report_id text, credits_used int, created_at timestamptz DEFAULT now());

CREATE TABLE api_usage (
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE, service text NOT NULL, endpoint text NOT NULL,
  units int NOT NULL DEFAULT 1, cost_cents int NOT NULL DEFAULT 0, day date NOT NULL DEFAULT current_date,
  PRIMARY KEY (company_id, service, endpoint, day));
