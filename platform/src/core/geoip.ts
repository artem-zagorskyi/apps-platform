import maxmind, { type CityResponse, type Reader } from 'maxmind';

// Where an IP is, as precise as a city. Coordinates are the city centre,
// never the device position. The IP itself is never stored.
export interface GeoLocation {
  country: string | null; // ISO code, e.g. "DE"
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

let reader: Reader<CityResponse> | null = null;

// Opens the city database (DB-IP City Lite or GeoLite2 City, both .mmdb) once
// at start-up. Without a path the server works and every lookup returns null.
// The whole file is kept in memory: about 130 MB for DB-IP City Lite.
export async function openGeoIp(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  reader = await maxmind.open<CityResponse>(path);
  return true;
}

export function locate(ip: string): GeoLocation | null {
  if (!reader || !maxmind.validate(ip)) return null;
  const found = reader.get(ip);
  if (!found) return null;
  return {
    country: found.country?.iso_code ?? null,
    region: found.subdivisions?.[0]?.names?.en ?? null,
    city: found.city?.names?.en ?? null,
    lat: found.location?.latitude ?? null,
    lon: found.location?.longitude ?? null,
  };
}

// ISO country code (e.g. "DE") for an IP, or null
export function countryOf(ip: string): string | null {
  return locate(ip)?.country ?? null;
}
