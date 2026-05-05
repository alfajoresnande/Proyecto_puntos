import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api";

type Orden = {
  id: number;
  estado: string;
  tipo_orden: "canje" | "venta" | "mixta";
  total_dinero: number;
  total_puntos: number;
  moneda: string;
  total_items: number;
  total_unidades: number;
  created_at: string;
  sucursal?: {
    nombre: string | null;
    direccion: string | null;
    localidad: string | null;
    provincia: string | null;
  } | null;
};

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function MisPedidos() {
  const ordenesQuery = useQuery({
    queryKey: ["cliente", "ordenes"],
    queryFn: () => api.get<Orden[]>("/cliente/ordenes"),
  });

  const pedidos = (ordenesQuery.data ?? []).filter((orden) => orden.tipo_orden === "venta" || orden.tipo_orden === "mixta");

  return (
    <section className="catalog-page catalog-canje-page">
      <div className="catalog-products-shell">
        <div className="catalog-header">
          <h1 className="catalog-title">Mis pedidos</h1>
          <p className="catalog-subtitle">Compras online y estados de pago/retiro</p>
        </div>

        {ordenesQuery.isLoading ? (
          <div className="catalog-skeleton store-skeleton" />
        ) : pedidos.length === 0 ? (
          <div className="catalog-canje-block">
            <p>Todavia no tienes pedidos online.</p>
            <Link className="product-card-btn product-card-btn-canjear" to="/tienda">Ir a tienda</Link>
          </div>
        ) : (
          <div className="store-orders-list">
            {pedidos.map((orden) => (
              <article key={orden.id} className="store-order-card">
                <div>
                  <p className="store-order-title">Pedido #{orden.id}</p>
                  <p className="store-order-muted">{dateLabel(orden.created_at)} - {orden.total_unidades} producto(s)</p>
                </div>
                <div className="store-order-meta">
                  <span className="store-order-status">{orden.estado}</span>
                  <strong>{money(orden.total_dinero)}</strong>
                </div>
                {orden.sucursal?.nombre ? (
                  <p className="store-order-muted">Retiro: {orden.sucursal.nombre}</p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
