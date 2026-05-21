import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { formatBuenosAiresDateTime } from "../../lib/dateTime";
import { useAuthStore } from "../../store/authStore";
import "../../styles/vendedor-ventas.css";

type PedidoMapa = {
  id: number;
  cliente_nombre: string;
  cliente_email: string | null;
  canal: "web" | "admin" | "vendedor" | string;
  estado: "pendiente_pago" | "pagada" | "preparada" | "enviada" | "entregada" | string;
  tipo_orden: "venta" | "mixta" | string;
  total_dinero: number;
  total_puntos: number;
  created_at: string;
  direccion_envio: {
    id?: number | null;
    alias?: string | null;
    nombre?: string | null;
    telefono?: string | null;
    direccion?: string | null;
    direccion_formateada?: string | null;
    calle?: string | null;
    numero?: string | null;
    piso_departamento?: string | null;
    barrio?: string | null;
    localidad?: string | null;
    provincia?: string | null;
    codigo_postal?: string | null;
    pais?: string | null;
    referencias?: string | null;
    lat: number;
    lng: number;
  };
};

const CORRIENTES_CENTER = {
  lat: -27.4692,
  lng: -58.8306,
};

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY?.trim() ?? "";
const GEOAPIFY_TILE_URL = `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(
  GEOAPIFY_API_KEY,
)}`;

const orderMarkerIcon = L.divIcon({
  className: "orders-map-marker",
  html: '<span class="orders-map-marker-dot"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const selectedOrderMarkerIcon = L.divIcon({
  className: "orders-map-marker orders-map-marker-selected",
  html: '<span class="orders-map-marker-dot"></span>',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function estadoLabel(estado: string): string {
  const labels: Record<string, string> = {
    pendiente_pago: "Pendiente pago",
    pagada: "Pagada",
    preparada: "Preparada",
    enviada: "Enviada",
    entregada: "Entregada",
  };
  return labels[estado] ?? estado;
}

function canalLabel(canal: string): string {
  const labels: Record<string, string> = {
    web: "Web",
    admin: "Admin",
    vendedor: "Vendedor",
  };
  return labels[canal] ?? canal;
}

function addressLabel(order: PedidoMapa): string {
  const address = order.direccion_envio;
  return (
    address.direccion_formateada ||
    address.direccion ||
    [address.calle, address.numero, address.barrio, address.localidad].filter(Boolean).join(", ") ||
    "Direccion sin detalle"
  );
}

function isRecentOrder(order: PedidoMapa): boolean {
  const createdAt = new Date(order.created_at).getTime();
  if (!Number.isFinite(createdAt)) return false;
  const elapsed = Date.now() - createdAt;
  return elapsed >= 0 && elapsed <= 24 * 60 * 60 * 1000;
}

function formatCoord(value: number): string {
  return value.toFixed(6);
}

export function PedidosMapa() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const pedidosPath =
    user?.rol === "superAdmin"
      ? "/superadmin/ventas/pedidos"
      : user?.rol === "admin"
        ? "/admin/ventas/pedidos"
        : "/vendedor/ventas/pedidos";

  const selectedOrderId = useMemo(() => {
    const raw = Number(searchParams.get("pedido") ?? 0);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }, [searchParams]);

  const pedidosQuery = useQuery({
    queryKey: ["vendedor", "ordenes", "mapa", selectedOrderId],
    queryFn: () => {
      const qs = selectedOrderId ? `?pedido_id=${selectedOrderId}` : "";
      return api.get<PedidoMapa[]>(`/vendedor/ordenes/mapa${qs}`);
    },
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const pedidos = pedidosQuery.data ?? [];
  const pedidosRecientes = useMemo(() => pedidos.filter(isRecentOrder), [pedidos]);
  const selectedOrder = useMemo(() => {
    if (selectedOrderId) {
      const found = pedidos.find((pedido) => pedido.id === selectedOrderId);
      if (found) return found;
    }
    return pedidosRecientes[0] ?? pedidos[0] ?? null;
  }, [pedidos, pedidosRecientes, selectedOrderId]);

  const selectOrder = useCallback(
    (orderId: number) => {
      const next = new URLSearchParams(searchParams);
      next.set("pedido", String(orderId));
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined;

    const map = L.map(mapContainerRef.current, {
      center: [CORRIENTES_CENTER.lat, CORRIENTES_CENTER.lng],
      zoom: 13,
      scrollWheelZoom: true,
    });

    if (GEOAPIFY_API_KEY) {
      L.tileLayer(GEOAPIFY_TILE_URL, {
        maxZoom: 20,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.geoapify.com/">Geoapify</a>',
      }).addTo(map);
    }

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
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
    const bounds = L.latLngBounds([]);

    for (const pedido of pedidos) {
      const latLng: L.LatLngExpression = [pedido.direccion_envio.lat, pedido.direccion_envio.lng];
      const marker = L.marker(latLng, {
        icon: selectedOrder?.id === pedido.id ? selectedOrderMarkerIcon : orderMarkerIcon,
      });
      marker.bindTooltip(`#${pedido.id} - ${pedido.cliente_nombre}`, { direction: "top" });
      marker.on("click", () => selectOrder(pedido.id));
      marker.addTo(layer);
      bounds.extend(latLng);
    }

    if (selectedOrder) {
      map.setView([selectedOrder.direccion_envio.lat, selectedOrder.direccion_envio.lng], Math.max(map.getZoom(), 15), {
        animate: true,
      });
    } else if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [34, 34], maxZoom: 15 });
    }

    window.setTimeout(() => map.invalidateSize(), 0);
  }, [pedidos, selectOrder, selectedOrder]);

  return (
    <section className="catalog-page catalog-canje-page orders-map-page">
      <div className="catalog-products-shell orders-map-shell">
        <div className="orders-map-header">
          <div>
            <h1 className="catalog-title">Mapa de pedidos</h1>
            <p className="catalog-subtitle">Pedidos con envio creados en las ultimas 24 horas</p>
          </div>
          <div className="orders-map-header-actions">
            <button className="ios-btn-secondary" type="button" onClick={() => void pedidosQuery.refetch()}>
              Actualizar
            </button>
            <Link className="ios-btn-secondary" to={pedidosPath}>
              Ver pedidos
            </Link>
          </div>
        </div>

        <div className="orders-map-layout">
          <aside className="orders-map-list" aria-label="Pedidos con envio">
            <div className="orders-map-list-head">
              <strong>{pedidosRecientes.length} pedidos</strong>
              <span>Ultimas 24 h</span>
            </div>

            {pedidosQuery.isLoading ? <div className="orders-map-empty">Cargando pedidos...</div> : null}
            {!pedidosQuery.isLoading && pedidos.length === 0 ? (
              <div className="orders-map-empty">No hay pedidos con envio y coordenadas para mostrar.</div>
            ) : null}

            {pedidos.map((pedido) => {
              const selected = selectedOrder?.id === pedido.id;
              const recent = isRecentOrder(pedido);
              return (
                <button
                  key={pedido.id}
                  type="button"
                  className={`orders-map-order${selected ? " active" : ""}`}
                  onClick={() => selectOrder(pedido.id)}
                >
                  <span>
                    Pedido #{pedido.id} - {estadoLabel(pedido.estado)}
                  </span>
                  <small>
                    {formatBuenosAiresDateTime(pedido.created_at)} - {canalLabel(pedido.canal)}
                  </small>
                  <small>{pedido.cliente_nombre}</small>
                  <small>{addressLabel(pedido)}</small>
                  {!recent ? <em>Pedido seleccionado fuera de las ultimas 24 h</em> : null}
                </button>
              );
            })}
          </aside>

          <div className="orders-map-main">
            <div className="orders-map-panel">
              <div ref={mapContainerRef} className="orders-map-canvas" aria-label="Mapa de pedidos con envio" />
              {!GEOAPIFY_API_KEY ? (
                <div className="address-map-config-warning">Falta configurar VITE_GEOAPIFY_API_KEY para cargar el mapa.</div>
              ) : null}
            </div>

            {selectedOrder ? (
              <div className="orders-map-detail">
                <div>
                  <p className="orders-map-detail-title">
                    Pedido #{selectedOrder.id} - {estadoLabel(selectedOrder.estado)}
                  </p>
                  <p>{selectedOrder.cliente_nombre}</p>
                  <p>{addressLabel(selectedOrder)}</p>
                  {selectedOrder.direccion_envio.telefono ? <p>Telefono: {selectedOrder.direccion_envio.telefono}</p> : null}
                  {selectedOrder.direccion_envio.referencias ? <p>Referencia: {selectedOrder.direccion_envio.referencias}</p> : null}
                </div>
                <div>
                  <p className="orders-map-detail-total">{money(selectedOrder.total_dinero)}</p>
                  <p>
                    Lat {formatCoord(selectedOrder.direccion_envio.lat)} / Lng {formatCoord(selectedOrder.direccion_envio.lng)}
                  </p>
                  <Link className="ios-btn-primary" to={`/vendedor/pedidos/${selectedOrder.id}`}>
                    Ver comprobante
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
