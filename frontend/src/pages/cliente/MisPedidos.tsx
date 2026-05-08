import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  direccion_envio?: {
    nombre?: string;
    telefono?: string;
    direccion?: string;
    codigo_postal?: string;
    localidad?: string;
    provincia?: string;
  } | null;
  sucursal?: {
    nombre: string | null;
    direccion: string | null;
    localidad: string | null;
    provincia: string | null;
  } | null;
};

type MercadoPagoReturnResponse = {
  ok: boolean;
  orden_id: number;
  estado: string;
  pago_estado?: string;
  status_detail?: string | null;
  already_paid?: boolean;
  provider_payment_id?: string | null;
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

function estadoPedidoLabel(estado: string): string {
  const normalized = estado.trim().toLowerCase();
  const labels: Record<string, string> = {
    pendiente_pago: "Pendiente de pago",
    pagada: "Pago aprobado",
    preparada: "Preparando pedido",
    enviada: "En camino",
    entregada: "Entregado",
    cancelada: "Cancelado",
    expirada: "Expirado",
  };
  return labels[normalized] ?? estado;
}

function estadoPedidoClass(estado: string): string {
  const normalized = estado.trim().toLowerCase();
  if (normalized === "pagada" || normalized === "preparada" || normalized === "entregada") return " is-ok";
  if (normalized === "pendiente_pago") return " is-pending";
  if (normalized === "cancelada" || normalized === "expirada") return " is-danger";
  return "";
}

export function MisPedidos() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasProcessedReturnRef = useRef(false);
  const ordenesQuery = useQuery({
    queryKey: ["cliente", "ordenes"],
    queryFn: () => api.get<Orden[]>("/cliente/ordenes"),
    refetchInterval: (query) => {
      const orders = query.state.data ?? [];
      return orders.some((orden) => orden.estado === "pendiente_pago") ? 5000 : false;
    },
  });
  const confirmReturnMutation = useMutation({
    mutationFn: (payload: { payment_id?: string | null; external_reference?: string | null; status?: string | null }) =>
      api.post<MercadoPagoReturnResponse>("/cliente/checkout/mercadopago/confirm-return", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] });
    },
  });

  useEffect(() => {
    const paymentId = searchParams.get("payment_id") || searchParams.get("collection_id");
    const externalReference = searchParams.get("external_reference");
    const status = searchParams.get("status") || searchParams.get("collection_status");

    if (hasProcessedReturnRef.current) return;
    if (!paymentId && !externalReference) return;

    hasProcessedReturnRef.current = true;
    confirmReturnMutation.mutate(
      {
        payment_id: paymentId,
        external_reference: externalReference,
        status,
      },
      {
        onSettled: () => {
          const nextParams = new URLSearchParams(searchParams);
          [
            "payment_id",
            "collection_id",
            "collection_status",
            "status",
            "external_reference",
            "merchant_order_id",
            "preference_id",
          ].forEach((key) => nextParams.delete(key));
          setSearchParams(nextParams, { replace: true });
        },
      },
    );
  }, [confirmReturnMutation, searchParams, setSearchParams]);

  const pedidos = (ordenesQuery.data ?? []).filter((orden) => orden.tipo_orden === "venta" || orden.tipo_orden === "mixta");

  return (
    <section className="catalog-page catalog-canje-page">
      <div className="catalog-products-shell">
        <div className="catalog-header">
          <h1 className="catalog-title">Mis pedidos</h1>
          <p className="catalog-subtitle">Compras online y estados de pago/entrega</p>
        </div>

        {confirmReturnMutation.isPending ? (
          <div className="catalog-canje-block">
            <p>Actualizando el estado del pago...</p>
          </div>
        ) : null}

        {confirmReturnMutation.isError ? (
          <div className="catalog-canje-block">
            <p>No pudimos actualizar automaticamente el pago. Estamos reintentando desde el historial.</p>
          </div>
        ) : null}

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
                  <span className={`store-order-status${estadoPedidoClass(orden.estado)}`}>
                    {estadoPedidoLabel(orden.estado)}
                  </span>
                  <strong>{money(orden.total_dinero)}</strong>
                </div>
                {orden.estado === "pagada" ? (
                  <p className="store-order-paid-msg">Muchas gracias por tu compra. Pago aprobado.</p>
                ) : null}
                {orden.direccion_envio ? (
                  <p className="store-order-muted">
                    Envio: {orden.direccion_envio.direccion}, {orden.direccion_envio.localidad} ({orden.direccion_envio.codigo_postal})
                  </p>
                ) : orden.sucursal?.nombre ? (
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
