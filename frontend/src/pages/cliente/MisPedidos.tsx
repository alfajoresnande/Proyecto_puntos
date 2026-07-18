import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { CatalogPagination } from "../../components/CatalogPagination";
import { useToast } from "../../components/ToastProvider";
import { formatBuenosAiresDate } from "../../lib/dateTime";

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
  orderId?: number;
};

const APPROVED_ORDER_STATES = new Set(["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"]);

function isApprovedOrderState(estado: string | null | undefined): boolean {
  return APPROVED_ORDER_STATES.has(String(estado ?? "").trim().toLowerCase());
}

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatBuenosAiresDate(date);
}

function estadoPedidoLabel(estado: string): string {
  const normalized = estado.trim().toLowerCase();
  const labels: Record<string, string> = {
    borrador: "Pendiente de pago",
    pendiente_pago: "Pendiente de pago",
    pagada: "Pedido recibido",
    preparandose: "Preparando pedido",
    preparada: "Pedido preparado",
    enviada: "En camino",
    entregando: "Entregando pedido",
    entregada: "Entregado",
    cancelada: "Cancelado",
    expirada: "Expirado",
  };
  return labels[normalized] ?? estado;
}

function estadoPedidoClass(estado: string): string {
  const normalized = estado.trim().toLowerCase();
  if (["pagada", "preparandose", "preparada", "enviada", "entregando", "entregada"].includes(normalized)) return " is-ok";
  if (normalized === "pendiente_pago" || normalized === "borrador") return " is-pending";
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

function paymentWasCompleted(orden: Orden): boolean {
  const pagoEstado = orden.pago?.estado?.trim().toLowerCase() ?? "";
  return pagoEstado === "aprobado" || pagoEstado === "reembolsado";
}

function paymentSummaryLabel(orden: Orden): string {
  const estado = orden.estado.trim().toLowerCase();
  if ((estado === "cancelada" || estado === "expirada") && !paymentWasCompleted(orden)) {
    return "No realizado";
  }
  return paymentMethodLabel(orden.pago?.metodo);
}

function branchLabel(sucursal: Orden["sucursal"]): string {
  if (!sucursal?.nombre) return "-";
  return [sucursal.nombre, sucursal.direccion, sucursal.piso ? `Piso ${sucursal.piso}` : "", sucursal.localidad, sucursal.provincia]
    .filter(Boolean)
    .join(", ");
}

function canContinueOnlinePayment(orden: Orden): boolean {
  return (
    (orden.estado === "pendiente_pago" || orden.estado === "borrador") &&
    orden.pago?.proveedor === "mercadopago" &&
    orden.pago?.estado === "iniciado"
  );
}

function canCancelOrder(orden: Orden): boolean {
  return ["borrador", "pendiente_pago"].includes(orden.estado.trim().toLowerCase());
}

function hasActiveShippingTracking(orden: Orden): boolean {
  const estado = orden.estado.trim().toLowerCase();
  return Boolean(orden.direccion_envio) && ["pagada", "preparandose", "preparada", "enviada", "entregando"].includes(estado);
}

const SHIPPING_TRACKING_STEPS = [
  { key: "recibido", label: "Recibido" },
  { key: "preparandose", label: "Preparandose" },
  { key: "preparada", label: "Preparado" },
  { key: "enviado", label: "Enviado" },
  { key: "entregando", label: "Entregando" },
  { key: "entregado", label: "Entregado" },
];

const SHIPPING_TRACKING_INDEX: Record<string, number> = {
  pagada: 0,
  preparandose: 1,
  preparada: 2,
  enviada: 3,
  entregando: 4,
  entregada: 5,
};

const SHIPPING_TRACKING_COPY: Record<string, string> = {
  pagada: "Recibimos tu pedido.",
  preparandose: "El equipo esta preparando tu pedido.",
  preparada: "Tu pedido ya esta preparado y listo para salir.",
  enviada: "Tu pedido fue enviado.",
  entregando: "Estamos realizando la entrega.",
  entregada: "Pedido entregado.",
};

const MIS_PEDIDOS_POR_PAGINA = 5;

function OrderShippingTracking({ orden }: { orden: Orden }) {
  if (!orden.direccion_envio) return null;
  const normalized = orden.estado.trim().toLowerCase();
  const activeIndex = SHIPPING_TRACKING_INDEX[normalized];
  if (activeIndex === undefined) return null;
  const progress = activeIndex <= 0 ? 0 : (activeIndex / (SHIPPING_TRACKING_STEPS.length - 1)) * 100;
  const currentLabel = estadoPedidoLabel(orden.estado);
  const currentCopy = SHIPPING_TRACKING_COPY[normalized] ?? "Actualizamos el estado cuando avance el pedido.";
  const currentInfoStartColumn = Math.max(0, Math.min(activeIndex - 1, SHIPPING_TRACKING_STEPS.length - 3)) + 1;

  return (
    <div className="store-order-tracking" aria-label={`Seguimiento del pedido ${orden.id}`}>
      <div className="store-order-track-current-row">
        <div
          className="store-order-track-current-card"
          style={{ gridColumn: `${currentInfoStartColumn} / span 3` }}
        >
          <strong>{currentLabel}</strong>
          <span>{currentCopy}</span>
        </div>
      </div>
      <div className="store-order-track-line" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="store-order-track-steps">
        {SHIPPING_TRACKING_STEPS.map((step, index) => {
          const stateClass = index < activeIndex ? " is-complete" : index === activeIndex ? " is-current" : "";
          return (
            <li key={step.key} className={`store-order-track-step${stateClass}`}>
              <span>{index + 1}</span>
              <p>{step.label}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function MisPedidos() {
  const queryClient = useQueryClient();
  const { confirmToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasProcessedReturnRef = useRef(false);
  const [returnNotice, setReturnNotice] = useState<ReturnNotice | null>(null);
  const [pedidosPage, setPedidosPage] = useState(1);
  const ordenesQuery = useQuery({
    queryKey: ["cliente", "ordenes"],
    queryFn: () => api.get<Orden[]>("/cliente/ordenes"),
    refetchInterval: (query) => {
      const orders = query.state.data ?? [];
      return orders.some((orden) => ["pendiente_pago", "pagada", "preparandose", "preparada", "enviada", "entregando"].includes(orden.estado)) ? 5000 : 15000;
    },
    refetchIntervalInBackground: true,
  });
  const confirmReturnMutation = useMutation({
    mutationFn: (payload: { payment_id?: string | null; external_reference?: string | null; status?: string | null }) =>
      api.post<MercadoPagoReturnResponse>("/cliente/checkout/mercadopago/confirm-return", payload),
    onSuccess: async (response) => {
      const approvedState = isApprovedOrderState(response.estado);
      setPedidosPage(1);
      setReturnNotice(
        approvedState
          ? {
              variant: "success",
              msg: "Pago aprobado. Ya registramos tu pedido y el equipo va a prepararlo.",
              orderId: response.orden_id > 0 ? response.orden_id : undefined,
            }
          : {
              variant: "info",
              msg: "Recibimos el retorno de Mercado Pago. Si el pago queda pendiente, lo actualizamos automaticamente al recibir la confirmacion.",
              orderId: response.orden_id > 0 ? response.orden_id : undefined,
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
  const cancelOrderMutation = useMutation({
    mutationFn: (ordenId: number) => api.post<{ ok: true; orden_id: number; estado: string }>(`/cliente/ordenes/${ordenId}/cancelar`, {}),
    onSuccess: async (response) => {
      setReturnNotice({
        variant: "info",
        msg: `Pedido #${response.orden_id} cancelado. Por cualquier consulta comuniquese a traves de la mensajeria. Muchas gracias vuelva pronto.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cliente", "ordenes"] }),
        queryClient.invalidateQueries({ queryKey: ["cliente", "carrito-online"] }),
        queryClient.invalidateQueries({ queryKey: ["productos"] }),
      ]);
    },
    onError: (error: Error) => {
      setReturnNotice({
        variant: "error",
        msg: error.message || "No se pudo cancelar el pedido.",
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
        onSettled: (data) => {
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
          if (data?.orden_id && data.orden_id > 0) {
            nextParams.set("pedido", String(data.orden_id));
          }
          setSearchParams(nextParams, { replace: true });
        },
      },
    );
  }, [confirmReturnMutation, searchParams, setSearchParams]);

  const pedidos = useMemo(
    () => (ordenesQuery.data ?? []).filter((orden) => orden.tipo_orden === "venta" || orden.tipo_orden === "mixta"),
    [ordenesQuery.data],
  );
  const activeShippingPedidos = useMemo(() => pedidos.filter(hasActiveShippingTracking), [pedidos]);
  const pendingPaymentPedidos = useMemo(
    () => pedidos.filter((orden) => ["borrador", "pendiente_pago"].includes(orden.estado.trim().toLowerCase())),
    [pedidos],
  );
  const requestedPedidoId = Number(searchParams.get("pedido") ?? 0);
  const pedidosTotalPages = Math.max(1, Math.ceil(pedidos.length / MIS_PEDIDOS_POR_PAGINA));
  const pedidosPagina = useMemo(() => {
    const safePage = Math.min(Math.max(1, pedidosPage), pedidosTotalPages);
    const start = (safePage - 1) * MIS_PEDIDOS_POR_PAGINA;
    return pedidos.slice(start, start + MIS_PEDIDOS_POR_PAGINA);
  }, [pedidos, pedidosPage, pedidosTotalPages]);

  useEffect(() => {
    setPedidosPage((prev) => Math.min(prev, pedidosTotalPages));
  }, [pedidosTotalPages]);

  useEffect(() => {
    if (!Number.isInteger(requestedPedidoId) || requestedPedidoId <= 0) return;
    const pedidoIndex = pedidos.findIndex((orden) => orden.id === requestedPedidoId);
    if (pedidoIndex < 0) return;
    setPedidosPage(Math.floor(pedidoIndex / MIS_PEDIDOS_POR_PAGINA) + 1);
  }, [pedidos, requestedPedidoId]);

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
              {returnNotice.orderId ? (
                <Link className="catalog-float-toast-btn-primary" to={`/mis-pedidos/${returnNotice.orderId}`}>
                  Ver comprobante
                </Link>
              ) : null}
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

        {activeShippingPedidos.length > 0 ? (
          <div className="store-orders-active-shipping" role="status" aria-live="polite">
            <span className="store-orders-active-dot" aria-hidden="true" />
            <div>
              <strong>{activeShippingPedidos.length === 1 ? "Tenes un envio en seguimiento" : `Tenes ${activeShippingPedidos.length} envios en seguimiento`}</strong>
              <p>Revisa esta pantalla para ver como va progresando hasta que sea entregado.</p>
            </div>
          </div>
        ) : null}

        {pendingPaymentPedidos.length > 0 ? (
          <div className="store-orders-active-shipping store-orders-pending-payment" role="status" aria-live="polite">
            <span className="store-orders-active-dot" aria-hidden="true" />
            <div>
              <strong>{pendingPaymentPedidos.length === 1 ? "Tenes una compra pendiente de pago" : `Tenes ${pendingPaymentPedidos.length} compras pendientes de pago`}</strong>
              <p>Podes continuar el pago o cancelar la compra desde el pedido correspondiente.</p>
            </div>
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
          <>
            <div className="store-orders-list">
              {pedidosPagina.map((orden) => (
                <article key={orden.id} className={`store-order-card${orden.id === requestedPedidoId ? " is-highlighted" : ""}`}>
                  <div className="store-order-head">
                    <div className="store-order-main">
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
                  <div className="store-order-actions-row">
                    <span className="store-order-muted store-order-payment-label">Pago: {paymentSummaryLabel(orden)}</span>
                    <div className="catalog-float-toast-actions store-order-action-buttons">
                      {canContinueOnlinePayment(orden) ? (
                        <Link
                          to={`/carrito-tienda?pagar_orden=${orden.id}`}
                          className="catalog-float-toast-btn-primary"
                          style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}
                        >
                          Continuar pago
                        </Link>
                      ) : null}
                      {canCancelOrder(orden) ? (
                        <button
                          type="button"
                          className="store-order-cancel-btn"
                          disabled={cancelOrderMutation.isPending}
                          onClick={() =>
                            confirmToast({
                              tone: "danger",
                              title: "Cancelar compra",
                              message: `Se va a cancelar el pedido #${orden.id}. Esta accion libera la reserva y no se puede deshacer.`,
                              confirmLabel: cancelOrderMutation.isPending ? "Cancelando..." : "Cancelar compra",
                              cancelLabel: "Mantener pedido",
                              onConfirm: () => cancelOrderMutation.mutate(orden.id),
                            })
                          }
                        >
                          Cancelar compra
                        </button>
                      ) : null}
                      {!((orden.estado.trim().toLowerCase() === "cancelada" || orden.estado.trim().toLowerCase() === "expirada") && !paymentWasCompleted(orden)) ? (
                        <Link to={`/mis-pedidos/${orden.id}`} className="catalog-float-toast-btn-secondary" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
                          Ver comprobante
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <OrderShippingTracking orden={orden} />
                </article>
              ))}
            </div>
            <CatalogPagination
              page={pedidosPage}
              totalPages={pedidosTotalPages}
              totalItems={pedidos.length}
              pageSize={MIS_PEDIDOS_POR_PAGINA}
              itemLabel="pedidos"
              onPageChange={setPedidosPage}
            />
          </>
        )}
      </div>
    </section>
  );
}
