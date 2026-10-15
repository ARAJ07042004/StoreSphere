
import { useEffect, useMemo, useState } from "react";
import {
  MapPin,
  Search,
  Heart,
  LocateFixed,
  Store,
  ArrowUpRight,
  Navigation,
  X,
  Coffee,
  Clock,
  ExternalLink,
  LoaderCircle,
  MapPinned,
  AlertCircle,
} from "lucide-react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

type CityResult = {
  lat: string;
  lon: string;
  display_name: string;
  osm_type?: string;
  osm_id?: number;
  boundingbox?: string[];
};

type Cafe = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  image?: string;
};

const DEFAULT_CENTER: [number, number] = [23.2599, 77.4126];

const cafeIcon = L.divIcon({
  className: "custom-marker",
  html: '<div class="marker-pin" style="background:#285d46"><span></span></div>',
  iconSize: [34, 42],
  iconAnchor: [17, 38],
  popupAnchor: [0, -34],
});

function MapFocus({
  position,
  zoom,
}: {
  position: [number, number];
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(position, zoom, { duration: 0.7 });
  }, [map, position, zoom]);

  return null;
}

function getCafeImage(tags: Record<string, string>): string | undefined {
  const image = tags.image;

  if (image && /^https?:\/\//i.test(image)) {
    return image;
  }

  return undefined;
}

function getAddress(tags: Record<string, string>): string {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"],
  ].filter(Boolean);

  return parts.join(", ") || tags["addr:full"] || "Address not available";
}

function makeCafe(
  element: Record<string, unknown>,
): Cafe | null {
  const tags = (element.tags ?? {}) as Record<string, string>;

  const center = element.center as
    | { lat?: number; lon?: number }
    | undefined;

  const lat = typeof element.lat === "number" ? element.lat : center?.lat;
  const lon = typeof element.lon === "number" ? element.lon : center?.lon;

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null;
  }

  const type = String(element.type ?? "place");
  const id = String(element.id ?? `${lat}-${lon}`);

  return {
    id: `${type}-${id}`,
    name: tags.name || "Unnamed cafe",
    lat,
    lon,
    address: getAddress(tags),
    openingHours: tags.opening_hours,
    phone: tags.phone || tags["contact:phone"],
    website: tags.website || tags["contact:website"],
    image: getCafeImage(tags),
  };
}

async function searchCity(city: string): Promise<CityResult> {
  const params = new URLSearchParams({
    q: city,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
  );

  if (!response.ok) {
    throw new Error("Unable to search for this city. Please try again.");
  }

  const results = (await response.json()) as CityResult[];

  if (!results.length) {
    throw new Error("City not found. Try a city name with its state or country.");
  }

  return results[0];
}

async function fetchCityCafes(city: CityResult): Promise<Cafe[]> {
  let areaId: number | null = null;

  if (city.osm_type && city.osm_id) {
    if (city.osm_type === "relation") {
      areaId = 3600000000 + city.osm_id;
    } else if (city.osm_type === "way") {
      areaId = 2400000000 + city.osm_id;
    }
  }

  let query: string;

  if (areaId !== null) {
    query = `
      [out:json][timeout:30];
      area(${areaId})->.cityArea;
      nwr["amenity"="cafe"](area.cityArea);
      out center tags;
    `;
  } else if (city.boundingbox?.length === 4) {
    const [south, north, west, east] = city.boundingbox.map(Number);

    query = `
      [out:json][timeout:30];
      nwr["amenity"="cafe"](${south},${west},${north},${east});
      out center tags;
    `;
  } else {
    throw new Error("No geographic boundary was found for this city.");
  }

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  let lastError: unknown;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ data: query }),
      });

      if (!response.ok) {
        throw new Error("The map data service is temporarily unavailable.");
      }

      const data = (await response.json()) as {
        elements?: Record<string, unknown>[];
      };

      const unique = new Map<string, Cafe>();

      for (const element of data.elements ?? []) {
        const cafe = makeCafe(element);

        if (cafe) {
          unique.set(cafe.id, cafe);
        }
      }

      return [...unique.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to load cafe data. Please try again later.");
}

export default function App() {
  const [cityInput, setCityInput] = useState("");
  const [searchedCity, setSearchedCity] = useState("Bhopal");
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [selectedCafe, setSelectedCafe] = useState<Cafe | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("storesphere-cafe-favorites");
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [cityCenter, setCityCenter] =
    useState<[number, number]>(DEFAULT_CENTER);
  const [mapPosition, setMapPosition] =
    useState<[number, number]>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    localStorage.setItem(
      "storesphere-cafe-favorites",
      JSON.stringify(favorites),
    );
  }, [favorites]);

  const visibleCafes = useMemo(
    () =>
      favoritesOnly
        ? cafes.filter((cafe) => favorites.includes(cafe.id))
        : cafes,
    [cafes, favorites, favoritesOnly],
  );

  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cityName = cityInput.trim();

    if (!cityName || loading) return;

    setLoading(true);
    setError("");
    setHasSearched(false);
    setSelectedCafe(null);
    setFavoritesOnly(false);

    try {
      const city = await searchCity(cityName);
      const lat = Number(city.lat);
      const lon = Number(city.lon);

      setSearchedCity(city.display_name.split(",").slice(0, 2).join(","));
      setCityCenter([lat, lon]);
      setMapPosition([lat, lon]);
      setMapZoom(12);

      const results = await fetchCityCafes(city);

      setCafes(results);
      setHasSearched(true);

      if (results.length === 0) {
        setError(
          "No cafes were found in the available OpenStreetMap data for this city.",
        );
      }
    } catch (err) {
      setCafes([]);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  function selectCafe(cafe: Cafe) {
    setSelectedCafe(cafe);
    setMapPosition([cafe.lat, cafe.lon]);
    setMapZoom(16);
  }

  function resetMap() {
    setSelectedCafe(null);
    setMapPosition(cityCenter);
    setMapZoom(12);
  }

  function getDirections(cafe: Cafe) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${cafe.lat},${cafe.lon}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Your browser does not support location services.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: [number, number] = [
          position.coords.latitude,
          position.coords.longitude,
        ];

        setMapPosition(location);
        setMapZoom(14);
        setSelectedCafe(null);
      },
      () => {
        setError("Location access was denied. Check your browser permissions.");
      },
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="StoreSphere home">
          <span className="brand-symbol">
            <MapPinned size={24} />
          </span>
          <span className="brand-text">
            <strong>StoreSphere</strong>
            <small>YOUR CITY, DISCOVERED</small>
          </span>
        </a>

        <nav className="main-nav">
          <a href="#explore">Explore cafes</a>
          <a href="#map">Map view</a>
          <a href="#about">About</a>
        </nav>

        <div className="header-actions">
          <button
            className="saved-button"
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            <Heart
              size={17}
              fill={favoritesOnly ? "currentColor" : "none"}
            />
            Saved ({favorites.length})
          </button>

          <button className="location-button" onClick={useMyLocation}>
            <LocateFixed size={17} />
            My location
          </button>
        </div>
      </header>

      <section className="hero" id="explore">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="live-dot" />
            DISCOVER YOUR LOCAL CAFE SCENE
          </span>

          <h1>
            Every city has
            <br />
            <span>a favorite corner.</span>
          </h1>

          <p>
            Search a city, discover its cafes, explore their map locations,
            and preview the places you might love.
          </p>
        </div>

        <div className="hero-note">
          <Coffee size={24} />
          <span>
            <strong>Find your next coffee stop</strong>
            <small>Real places from OpenStreetMap data</small>
          </span>
        </div>
      </section>

      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <span className="section-label">CITY EXPLORER</span>
              <h2>Find cafes</h2>
            </div>
            <span className="total-count">{visibleCafes.length}</span>
          </div>

          <form className="search-field" onSubmit={handleSearch}>
            <Search size={19} />
            <input
              value={cityInput}
              onChange={(event) => setCityInput(event.target.value)}
              placeholder="Enter city, e.g. Indore, India"
              aria-label="Search city"
            />
            <button
              type="submit"
              disabled={loading || !cityInput.trim()}
              aria-label="Search city"
            >
              {loading ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <ArrowUpRight size={18} />
              )}
            </button>
          </form>

          <div className="city-caption">
            <MapPin size={14} />
            <span>{searchedCity}</span>
          </div>

          <div className="category-heading">Cafe results</div>

          <div className="category-chips">
            <button
              className={!favoritesOnly ? "category-chip chip-active" : "category-chip"}
              onClick={() => setFavoritesOnly(false)}
            >
              All cafes
            </button>
            <button
              className={favoritesOnly ? "category-chip chip-active" : "category-chip"}
              onClick={() => setFavoritesOnly(true)}
            >
              <Heart size={12} />
              Saved
            </button>
          </div>

          <div className="list-header">
            <span>CAFE DIRECTORY</span>
            <span>{visibleCafes.length} FOUND</span>
          </div>

          <div className="store-list">
            {loading && (
              <div className="empty-state">
                <LoaderCircle size={28} className="spin" />
                <strong>Searching for cafes...</strong>
                <p>Finding the city and loading map data.</p>
              </div>
            )}

            {!loading &&
              visibleCafes.map((cafe) => (
                <article
                  key={cafe.id}
                  className={
                    selectedCafe?.id === cafe.id
                      ? "store-card store-selected"
                      : "store-card"
                  }
                >
                  <button
                    className="store-select"
                    onClick={() => selectCafe(cafe)}
                  >
                    <span className="store-avatar cafe-avatar">
                      <Coffee size={20} />
                    </span>

                    <span className="store-information">
                      <strong>{cafe.name}</strong>
                      <span>Cafe</span>
                      <small>
                        <MapPin size={12} />
                        {cafe.address}
                      </small>
                    </span>

                    <ArrowUpRight size={17} />
                  </button>

                  <button
                    className="favorite-button"
                    onClick={() => toggleFavorite(cafe.id)}
                    aria-label={`Save ${cafe.name}`}
                  >
                    <Heart
                      size={16}
                      fill={
                        favorites.includes(cafe.id)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                </article>
              ))}

            {!loading && visibleCafes.length === 0 && (
              <div className="empty-state">
                {error ? (
                  <AlertCircle size={28} />
                ) : (
                  <Coffee size={28} />
                )}

                <strong>
                  {favoritesOnly
                    ? "No saved cafes"
                    : hasSearched
                      ? "No cafes found"
                      : "Ready to explore?"}
                </strong>

                <p>
                  {error ||
                    (favoritesOnly
                      ? "Save a cafe with the heart icon to see it here."
                      : "Search a city above to discover its cafes.")}
                </p>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <span className="footer-status" />
            <span>OpenStreetMap data</span>
            <span>LIVE</span>
          </div>
        </aside>

        <section className="map-section" id="map">
          <div className="map-toolbar">
            <div>
              <strong>Explore the map</strong>
              <small>{searchedCity}</small>
            </div>

            <span className="map-live">
              {visibleCafes.length} cafes
            </span>
          </div>

          <div className="map-canvas">
            <MapContainer
              center={DEFAULT_CENTER}
              zoom={12}
              scrollWheelZoom
              className="leaflet-map"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <MapFocus position={mapPosition} zoom={mapZoom} />

              {visibleCafes.map((cafe) => (
                <Marker
                  key={cafe.id}
                  position={[cafe.lat, cafe.lon]}
                  icon={cafeIcon}
                  eventHandlers={{
                    click: () => selectCafe(cafe),
                  }}
                >
                  <Popup>
                    <div className="map-popup">
                      <strong>{cafe.name}</strong>
                      <span>Cafe</span>
                      <p>{cafe.address}</p>
                      <button onClick={() => selectCafe(cafe)}>
                        Preview cafe
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            <div className="map-floating-label">
              <span className="map-floating-icon">
                <MapPin size={19} />
              </span>
              <span>
                <strong>{searchedCity.split(",")[0]}</strong>
                <small>{visibleCafes.length} cafes found</small>
              </span>
            </div>

            <button className="map-reset" onClick={resetMap}>
              <LocateFixed size={16} />
              City overview
            </button>
          </div>

          <div className="map-bottom">
            <span>
              <Store size={17} />
              Select any cafe marker to preview it
            </span>
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              Map data © OpenStreetMap
            </a>
          </div>
        </section>
      </main>

      {selectedCafe && (
        <div
          className="detail-overlay"
          onClick={() => setSelectedCafe(null)}
        >
          <section
            className="detail-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="detail-close"
              onClick={() => setSelectedCafe(null)}
              aria-label="Close cafe preview"
            >
              <X size={20} />
            </button>

            {selectedCafe.image ? (
              <img
                className="cafe-preview-image"
                src={selectedCafe.image}
                alt={selectedCafe.name}
              />
            ) : (
              <div className="cafe-preview-placeholder">
                <Coffee size={48} />
                <span>CAFE PREVIEW</span>
              </div>
            )}

            <span className="section-label">CAFE PREVIEW</span>
            <h2>{selectedCafe.name}</h2>
            <span className="detail-category">Cafe</span>

            <div className="detail-row">
              <MapPin size={18} />
              <span>{selectedCafe.address}</span>
            </div>

            {selectedCafe.openingHours && (
              <div className="detail-row">
                <Clock size={18} />
                <span>{selectedCafe.openingHours}</span>
              </div>
            )}

            {selectedCafe.phone && (
              <div className="detail-row">
                <ExternalLink size={18} />
                <a href={`tel:${selectedCafe.phone}`}>
                  {selectedCafe.phone}
                </a>
              </div>
            )}

            {selectedCafe.website && (
              <div className="detail-row">
                <ExternalLink size={18} />
                <a
                  href={selectedCafe.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  Visit website
                </a>
              </div>
            )}

            <div className="detail-row">
              <MapPin size={18} />
              <span>
                {selectedCafe.lat.toFixed(5)}, {selectedCafe.lon.toFixed(5)}
              </span>
            </div>

            <button
              className="directions-button"
              onClick={() => getDirections(selectedCafe)}
            >
              <Navigation size={17} />
              Get directions
            </button>

            <button
              className="detail-save"
              onClick={() => toggleFavorite(selectedCafe.id)}
            >
              <Heart
                size={17}
                fill={
                  favorites.includes(selectedCafe.id)
                    ? "currentColor"
                    : "none"
                }
              />
              {favorites.includes(selectedCafe.id)
                ? "Remove from saved cafes"
                : "Save this cafe"}
            </button>
          </section>
        </div>
      )}

      <footer className="page-footer" id="about">
        <span>© 2026 StoreSphere</span>
        <span>Discover local. Find your next favorite.</span>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap attribution
        </a>
      </footer>
    </div>
  );
}
