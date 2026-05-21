import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type MapPoint = {
  lat: number;
  lng: number;
};

type AddressMapPickerProps = {
  value: MapPoint | null;
  onChange: (value: MapPoint) => void;
  disabled?: boolean;
};

const CORRIENTES_CENTER: MapPoint = {
  lat: -27.4692,
  lng: -58.8306,
};

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY?.trim() ?? "";
const GEOAPIFY_TILE_URL = `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(
  GEOAPIFY_API_KEY,
)}`;

const addressMarkerIcon = L.divIcon({
  className: "address-map-marker",
  html: '<span class="address-map-marker-dot"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function formatCoord(value: number): string {
  return value.toFixed(6);
}

export function AddressMapPicker({ value, onChange, disabled = false }: AddressMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const disabledRef = useRef(disabled);
  const centeredRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    disabledRef.current = disabled;
    const marker = markerRef.current;
    if (!marker) return;
    if (disabled) {
      marker.dragging?.disable();
    } else {
      marker.dragging?.enable();
    }
  }, [disabled]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const initial = value ?? CORRIENTES_CENTER;
    const map = L.map(containerRef.current, {
      center: [initial.lat, initial.lng],
      zoom: value ? 16 : 13,
      scrollWheelZoom: true,
    });

    if (GEOAPIFY_API_KEY) {
      L.tileLayer(GEOAPIFY_TILE_URL, {
        maxZoom: 20,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.geoapify.com/">Geoapify</a>',
      }).addTo(map);
    }

    map.on("click", (event: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      onChangeRef.current({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    });

    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      centeredRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      centeredRef.current = false;
      return;
    }

    const latLng: L.LatLngExpression = [value.lat, value.lng];
    if (!markerRef.current) {
      const marker = L.marker(latLng, {
        draggable: !disabledRef.current,
        icon: addressMarkerIcon,
      }).addTo(map);
      marker.on("dragend", () => {
        if (disabledRef.current) return;
        const next = marker.getLatLng();
        onChangeRef.current({ lat: next.lat, lng: next.lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(latLng);
    }

    if (!centeredRef.current) {
      map.setView(latLng, Math.max(map.getZoom(), 16));
      centeredRef.current = true;
      window.setTimeout(() => map.invalidateSize(), 0);
    }
  }, [disabled, onChange, value]);

  return (
    <div className="address-map-picker">
      <div ref={containerRef} className="address-map-canvas" aria-label="Mapa para seleccionar ubicacion" />
      {!GEOAPIFY_API_KEY ? (
        <div className="address-map-config-warning">Falta configurar VITE_GEOAPIFY_API_KEY para cargar el mapa.</div>
      ) : null}
      <div className="address-map-status">
        {value ? (
          <span>
            Lat {formatCoord(value.lat)} / Lng {formatCoord(value.lng)}
          </span>
        ) : (
          <span>Todavia no marcaste una ubicacion.</span>
        )}
      </div>
    </div>
  );
}
