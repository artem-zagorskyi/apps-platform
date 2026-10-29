import maxmind, { type CountryResponse, type Reader } from 'maxmind';

let reader: Reader<CountryResponse> | null = null;

// Opens the country database once at start-up. Without a path the server
// works and every lookup returns null.
export async function openGeoIp(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  reader = await maxmind.open<CountryResponse>(path);
  return true;
}

// ISO country code (e.g. "DE") for an IP, or null. The IP itself is never stored.
export function countryOf(ip: string): string | null {
  if (!reader || !maxmind.validate(ip)) return null;
  return reader.get(ip)?.country?.iso_code ?? null;
}