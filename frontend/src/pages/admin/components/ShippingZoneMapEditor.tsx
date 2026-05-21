import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type ZoneMapPoint = {
  lat: number;
  lng: number;
};

type ShippingZoneMapEditorProps = {
  points: ZoneMapPoint[];
  onChange: (points: ZoneMapPoint[]) => void;
  color?: string;
  disabled?: boolean;
};

const CORRIENTES_CENTER: ZoneMapPoint = {
  lat: -27.4692,
  lng: -58.8306,
};

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY?.trim() ?? "";
const GEOAPIFY_TILE_URL = `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(
  GEOAPIFY_API_KEY,
)}`;

const vertexIcon = L.divIcon({
  className: "shipping-zone-vertex",
  html: '<span class="shipping-zone-vertex-dot"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function formatCoord(value: number): string {
  return value.toFixed(6);
}

export function ShippingZoneMapEditor({
  points,
  onChange,
  color = "#6B8F71",
  disabled = false,
}: ShippingZoneMapEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const disabledRef = useRef(disabled);
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const initial = points[0] ?? CORRIENTES_CENTER;
    const map = L.map(containerRef.current, {
      center: [initial.lat, initial.lng],
      zoom: points.length ? 14 : 12,
      scrollWheelZoom: true,
    });

    if (GEOAPIFY_API_KEY) {
      L.tileLayer(GEOAPIFY_TILE_URL, {
        maxZoom: 20,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.geoapify.com/">Geoapify</a>',
      }).addTo(map);
    }

    const layer = L.layerGroup().addTo(map);
    map.on("click", (event: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      onChangeRef.current([...pointsRef.current, { lat: event.latlng.lat, lng: event.latlng.lng }]);
    });

    mapRef.current = map;
    layerRef.current = layer;
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const latLngs = points.map((point) => L.latLng(point.lat, point.lng));

    if (latLngs.length >= 3) {
      L.polygon(latLngs, {
        color,
        fillColor: color,
        fillOpacity: 0.2,
        weight: 3,
      }).addTo(layer);
    } else if (latLngs.length >= 2) {
      L.polyline(latLngs, {
        color,
        weight: 3,
        dashArray: "6 6",
      }).addTo(layer);
    }

    latLngs.forEach((latLng, index) => {
      const marker = L.marker(latLng, {
        draggable: !disabledRef.current,
        icon: vertexIcon,
        title: `Punto ${index + 1}`,
      }).addTo(layer);
      marker.on("dragend", () => {
        if (disabledRef.current) return;
        const next = marker.getLatLng();
        const updated = pointsRef.current.map((point, pointIndex) =>
          pointIndex === index ? { lat: next.lat, lng: next.lng } : point,
        );
        onChangeRef.current(updated);
      });
    });

    if (latLngs.length) {
      const bounds = L.latLngBounds(latLngs);
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.25), { maxZoom: 15, animate: false });
      }
    }
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [color, points]);

  function undoPoint() {
    if (disabled || points.length === 0) return;
    onChange(points.slice(0, -1));
  }

  function clearPoints() {
    if (disabled || points.length === 0) return;
    onChange([]);
  }

  return (
    <div className="shipping-zone-map-editor">
      <div ref={containerRef} className="shipping-zone-map-canvas" aria-label="Mapa para dibujar zona de envio" />
      {!GEOAPIFY_API_KEY ? (
        <div className="address-map-config-warning">Falta configurar VITE_GEOAPIFY_API_KEY para cargar el mapa.</div>
      ) : null}
      <div className="shipping-zone-map-footer">
        <div>
          {points.length >= 3 ? (
            <span>{points.length} puntos marcados</span>
          ) : (
            <span>Marca al menos 3 puntos en el mapa para cerrar una zona.</span>
          )}
          {points[0] ? (
            <small>
              Inicio: {formatCoord(points[0].lat)} / {formatCoord(points[0].lng)}
            </small>
          ) : null}
        </div>
        <div className="shipping-zone-map-actions">
          <button type="button" className="adm-btn-link" onClick={undoPoint} disabled={disabled || points.length === 0}>
            Deshacer punto
          </button>
          <button type="button" className="adm-btn-danger" onClick={clearPoints} disabled={disabled || points.length === 0}>
            Limpiar
          </button>
        </div>
      </div>
    </div>
  );
}
