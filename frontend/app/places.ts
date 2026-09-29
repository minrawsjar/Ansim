// Cities the payout map knows, by country. The first city of each country is its capital, used when a
// contact's city is missing or not in this list. `side` keeps a city's map label clear of its neighbours.
type Side = 'r' | 'l' | 'd';
type City = { city: string; lat: number; lon: number; side?: Side };

const PLACES: Record<string, { country: string; side: Side; cities: City[] }> = {
  vietnam: {
    country: 'Vietnam', side: 'l',
    cities: [
      { city: 'Hanoi', lat: 21.03, lon: 105.85 },
      { city: 'Ho Chi Minh City', lat: 10.82, lon: 106.63 },
      { city: 'Da Nang', lat: 16.05, lon: 108.22, side: 'r' },
      { city: 'Hai Phong', lat: 20.86, lon: 106.68, side: 'r' },
      { city: 'Can Tho', lat: 10.03, lon: 105.78 },
      { city: 'Hue', lat: 16.46, lon: 107.59 },
      { city: 'Nha Trang', lat: 12.24, lon: 109.19, side: 'r' },
      { city: 'Vinh', lat: 18.68, lon: 105.68 },
      { city: 'Thanh Hoa', lat: 19.81, lon: 105.78 },
      { city: 'Nam Dinh', lat: 20.43, lon: 106.16, side: 'r' },
    ],
  },
  philippines: {
    country: 'Philippines', side: 'r',
    cities: [
      { city: 'Manila', lat: 14.6, lon: 120.98 },
      { city: 'Quezon City', lat: 14.68, lon: 121.04 },
      { city: 'Cebu City', lat: 10.32, lon: 123.89 },
      { city: 'Davao City', lat: 7.19, lon: 125.46 },
      { city: 'Iloilo City', lat: 10.72, lon: 122.56, side: 'l' },
      { city: 'Baguio', lat: 16.4, lon: 120.6, side: 'l' },
      { city: 'Cagayan de Oro', lat: 8.48, lon: 124.65 },
      { city: 'Bacolod', lat: 10.68, lon: 122.95, side: 'l' },
      { city: 'Zamboanga City', lat: 6.91, lon: 122.07, side: 'l' },
      { city: 'Tacloban', lat: 11.24, lon: 125.0 },
    ],
  },
  nepal: {
    country: 'Nepal', side: 'd',
    cities: [
      { city: 'Kathmandu', lat: 27.72, lon: 85.32 },
      { city: 'Pokhara', lat: 28.21, lon: 83.99, side: 'l' },
      { city: 'Lalitpur', lat: 27.67, lon: 85.32 },
      { city: 'Biratnagar', lat: 26.45, lon: 87.27, side: 'r' },
      { city: 'Birgunj', lat: 27.01, lon: 84.88, side: 'l' },
      { city: 'Bharatpur', lat: 27.68, lon: 84.43, side: 'l' },
      { city: 'Butwal', lat: 27.7, lon: 83.45, side: 'l' },
      { city: 'Dharan', lat: 26.81, lon: 87.28, side: 'r' },
      { city: 'Janakpur', lat: 26.73, lon: 85.92 },
      { city: 'Nepalgunj', lat: 28.05, lon: 81.62, side: 'l' },
    ],
  },
  cambodia: { country: 'Cambodia', side: 'd', cities: [{ city: 'Phnom Penh', lat: 11.56, lon: 104.92 }] },
  indonesia: { country: 'Indonesia', side: 'r', cities: [{ city: 'Jakarta', lat: -6.21, lon: 106.85 }] },
  thailand: { country: 'Thailand', side: 'd', cities: [{ city: 'Bangkok', lat: 13.76, lon: 100.5 }] },
  myanmar: { country: 'Myanmar', side: 'l', cities: [{ city: 'Yangon', lat: 16.84, lon: 96.17 }] },
  bangladesh: { country: 'Bangladesh', side: 'l', cities: [{ city: 'Dhaka', lat: 23.81, lon: 90.41 }] },
  'sri lanka': { country: 'Sri Lanka', side: 'r', cities: [{ city: 'Colombo', lat: 6.93, lon: 79.86 }] },
  uzbekistan: { country: 'Uzbekistan', side: 'r', cities: [{ city: 'Tashkent', lat: 41.3, lon: 69.24 }] },
  mongolia: { country: 'Mongolia', side: 'r', cities: [{ city: 'Ulaanbaatar', lat: 47.89, lon: 106.91 }] },
};
const ALIASES: Record<string, string> = { saigon: 'ho chi minh city', hcmc: 'ho chi minh city', cebu: 'cebu city', davao: 'davao city', iloilo: 'iloilo city' };

export type Place = { country: string; city: string; lat: number; lon: number; side: Side };

const key = (s: string | null | undefined) => s?.trim().toLowerCase() ?? '';

// Where to draw a contact: its city if known, otherwise its country's capital. Null for unknown countries.
export function placeFor(country: string | null | undefined, city?: string | null): Place | null {
  const c = PLACES[key(country)];
  if (!c) return null;
  const want = ALIASES[key(city)] ?? key(city);
  const p = c.cities.find((x) => x.city.toLowerCase() === want) ?? c.cities[0];
  return { country: c.country, city: p.city, lat: p.lat, lon: p.lon, side: p.side ?? c.side };
}

export const citiesOf = (country: string | null | undefined) => PLACES[key(country)]?.cities.map((c) => c.city) ?? [];
export const countries = () => Object.values(PLACES).map((c) => c.country);

// The known city nearest to a point, if one is within `maxKm`. Used on the family's phone, so exact
// coordinates never leave it: only the city name is sent.
export function nearestCity(lat: number, lon: number, maxKm = 150): Place | null {
  const rad = Math.PI / 180;
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const c of Object.values(PLACES)) {
    for (const p of c.cities) {
      const dLat = (p.lat - lat) * rad;
      const dLon = (p.lon - lon) * rad;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(p.lat * rad) * Math.sin(dLon / 2) ** 2;
      const km = 12742 * Math.asin(Math.sqrt(h));
      if (km < bestKm) [best, bestKm] = [{ country: c.country, city: p.city, lat: p.lat, lon: p.lon, side: p.side ?? c.side }, km];
    }
  }
  return bestKm <= maxKm ? best : null;
}
