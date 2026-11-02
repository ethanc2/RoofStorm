export type Role = 'rep' | 'manager' | 'admin';
export type Disposition = 'not_home' | 'not_interested' | 'callback' | 'inspection_set' | 'do_not_knock';
export type StormKind = 'hail' | 'wind';
export type LngLat = [number, number];

export interface Parcel {
  id: string; source: 'regrid' | 'swath' | 'county'; sourceId: string;
  siteAddress: string; city: string; state: string; zip: string;
  ownerName: string | null; mailingAddress: string | null; ownerOccupied: boolean | null;
  yearBuilt: number | null; assessedValue: number | null;
  centroid: LngLat; geometry?: GeoJSON.Polygon; fetchedAt: string;
}
export interface StormEvent { stormId: string; eventDate: string; kind: StormKind; hailIn: number | null; gustMph: number | null; }
export interface Storm { id: string; swathStormId: string; eventDate: string; kind: StormKind; maxHailIn: number | null; meanHailIn: number | null; maxGustMph: number | null; geometry: GeoJSON.MultiPolygon; }
export interface Knock { id: string; parcelId: string; userId: string; disposition: Disposition; note?: string; callbackAt?: string; createdAt: string; clientId: string; }
export interface JnJob { jnid: string; contactJnid: string | null; name: string; recordType: string | null; statusId: number | null; statusName: string | null; salesRep: string | null; address: string | null; centroid: LngLat | null; dateUpdated: string; }
export interface OwnerCard { parcel: Parcel; lastStorm: StormEvent | null; knocks: Knock[]; jobs: JnJob[]; }

export interface RouteStop { parcelId?: string; jobJnid?: string; lngLat: LngLat; label: string; }
export interface OptimizeRequest { stops: RouteStop[]; start: LngLat; end?: LngLat | null; roundTrip?: boolean; mode: 'walking' | 'driving'; }
export interface OptimizeResponse { order: number[]; distanceM: number; durationS: number; geometry?: GeoJSON.LineString; }

export interface InspectionRequest {
  parcelId: string; clientId: string; firstName: string; lastName: string; phone?: string; email?: string;
  scheduledAt: string; notes?: string;
}
export interface MailFilters { ownerOccupiedOnly?: boolean; minHailIn?: number; excludeJnContacts?: boolean; excludeDoNotKnock?: boolean; }
