import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
    piso?: string | null;
    localidad: string | null;
    provincia: string | null;
  } | null;
  items?: Array<{
    producto_id: number;
    nombre: string;
    cantidad: number;
    precio_dinero_unit: number | null;
    subtotal_dinero: number;
  }>;
  pago?: {
    proveedor: string;
    metodo: string | null;
    estado: string;
    monto: number;
    moneda: string;
  } | null;
  comprobante?: {
    leyenda_no_factura: string;
    dias_habiles: string;
    horario_habil: string;
    dias_vigencia_efectivo: number | null;
    fecha_limite_efectivo: string | null;
    retiro_en_sucursal: boolean;
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

type ReturnNotice = {
  variant: "success" | "error" | "info";
  msg: string;
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

function paymentMethodLabel(metodo: string | null | undefined): string {
  if (metodo === "cash") return "Efectivo al retirar";
  if (metodo === "wallet") return "Mercado Pago";
  if (metodo === "qr") return "QR Mercado Pago";
  if (metodo === "brick") return "Tarjeta";
  return "Sin definir";
}

function branchLabel(sucursal: Orden["sucursal"]): string {
  if (!sucursal?.nombre) return "-";
  return [sucursal.nombre, sucursal.direccion, sucursal.piso ? `Piso ${sucursal.piso}` : "", sucursal.localidad, sucursal.provincia]
    .filter(Boolean)
    .join(", ");
}

function canContinueOnlinePayment(orden: Orden): boolean {
  return (
    orden.estado === "pendiente_pago" &&
    orden.pago?.proveedor === "mercadopago" &&
    orden.pago?.estado === "iniciado"
  );
}

export function MisPedidos() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasProcessedReturnRef = useRef(false);
  const [returnNotice, setReturnNotice] = useState<ReturnNotice | null>(null);
  const ordenesQuery = useQuery({
    queryKey: ["cliente", "ordenes"],
    queryFn: () => api.get<Orden[]>("/cliente/ordenes"),
    refetchInterval: (query) => {
      const orders = query.state.data ?? [];
      return orders.some((orden) => ["pendiente_pago", "pagada", "preparada", "enviada"].includes(orden.estado)) ? 5000 : 15000;
    },
    refetchIntervalInBackground: true,
  });
  const confirmReturnMutation = useMutation({
    mutationFn: (payload: { payment_id?: string | null; external_reference?: string | null; status?: string | null }) =>
      api.post<MercadoPagoReturnResponse>("/cliente/checkout/mercadopago/confirm-return", payload),
    onSuccess: async (response) => {
      setReturnNotice(
        response.estado === "pagada"
          ? {
              variant: "success",
              msg: "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
            }
          : {
              variant: "info",
              msg: "Recibimos el retorno de Mercado Pago. Si el pago queda pendiente, lo actualizamos automaticamente al recibir la confirmacion.",
            },
      );
      await queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] });
    },
    onError: () => {
      setReturnNotice({
        variant: "error",
        msg: "No pudimos actualizar automaticamente el pago. Vamos a seguir consultando el estado desde tu historial.",
      });
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
            "mp_return",
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

        {returnNotice ? (
          <div className="catalog-canje-block" role="status" aria-live="polite">
            {returnNotice.variant === "success" ? (
              <img
                src="/nande_muchas_gracias.webp"
                alt="Pedido pagado con exito"
                className="store-order-thanks-image"
              />
            ) : null}
            <p>{returnNotice.msg}</p>
            <div className="catalog-float-toast-actions catalog-canje-actions">
              <button className="catalog-float-toast-btn-secondary" onClick={() => setReturnNotice(null)}>
                Cerrar
              </button>
            </div>
          </div>
        ) : null}

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
                <div className="store-order-head">
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
                </div>
                <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <span className="store-order-muted">Pago: {paymentMethodLabel(orden.pago?.metodo)}</span>
                  <div className="catalog-float-toast-actions" style={{ gap: "0.5rem", margin: 0 }}>
                    {canContinueOnlinePayment(orden) ? (
                      <Link
                        to={`/carrito-tienda?pagar_orden=${orden.id}`}
                        className="catalog-float-toast-btn-primary"
                        style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}
                      >
                        Continuar pago
                      </Link>
                    ) : null}
                    <Link to={`/mis-pedidos/${orden.id}`} className="catalog-float-toast-btn-secondary" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
                      Ver comprobante
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
