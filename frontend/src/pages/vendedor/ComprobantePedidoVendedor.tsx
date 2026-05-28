import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { formatBuenosAiresDateTime } from "../../lib/dateTime";
import "../../styles/comprobante.css";

type OrdenVendedorDetalle = {
  id: number;
  estado: string;
  canal: string;
  tipo_orden: "venta" | "mixta" | string;
  total_dinero: number;
  total_puntos: number;
  moneda: string;
  created_at: string;
  notas?: string | null;
  direccion_envio?: {
    nombre?: string;
    telefono?: string;
    direccion?: string;
    codigo_postal?: string;
    localidad?: string;
    provincia?: string;
    referencias?: string | null;
    costo_envio?: number | null;
    envio?: {
      zona_nombre?: string | null;
      costo_envio?: number | null;
    } | null;
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
    modo_compra: "dinero" | "puntos";
    precio_dinero_unit: number | null;
    puntaje_al_comprar_unitario?: number | null;
    subtotal_dinero: number;
    subtotal_puntos: number;
    sabores?: Array<{
      sabor_id: number;
      nombre: string;
      cantidad: number;
    }>;
  }>;
  pago?: {
    proveedor: string;
    metodo: string | null;
    estado: string;
    monto: number;
    moneda: string;
  } | null;
  usuario?: {
    nombre: string;
    email: string;
    dni: string | null;
    telefono?: string | null;
  };
};

const PRINT_STYLE_ID = "comprobante-print-page-style";

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function compactMoney(value: number | string | null | undefined): string {
  return money(value).replace(/\s/g, "");
}

function dateLabel(value: string): string {
  return formatBuenosAiresDateTime(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function estadoPedidoLabel(estado: string): string {
  const labels: Record<string, string> = {
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
  return labels[estado.trim().toLowerCase()] ?? estado;
}

function paymentMethodLabel(metodo: string | null | undefined): string {
  const normalized = (metodo || "").trim().toLowerCase();
  if (normalized === "cash" || normalized === "efectivo") return "Efectivo";
  if (normalized === "wallet") return "Mercado Pago";
  if (normalized === "qr") return "QR";
  if (normalized === "brick" || normalized === "tarjeta") return "Tarjeta";
  if (normalized === "transferencia") return "Transferencia";
  if (normalized === "otro") return "Otro";
  return "Sin definir";
}

function paymentProviderLabel(proveedor: string | null | undefined): string {
  const normalized = (proveedor || "").trim().toLowerCase();
  if (normalized === "mercadopago") return "Mercado Pago";
  if (normalized === "cash" || normalized === "efectivo") return "Efectivo";
  if (normalized === "local") return "Venta local";
  return proveedor || "Sin definir";
}

function canalLabel(canal: string | null | undefined): string {
  const normalized = (canal || "").trim().toLowerCase();
  if (normalized === "web") return "Web";
  if (normalized === "admin") return "Local admin";
  if (normalized === "vendedor") return "Local vendedor";
  return canal || "Sin definir";
}

function isLocalSaleOrder(orden: OrdenVendedorDetalle): boolean {
  const proveedor = orden.pago?.proveedor?.trim().toLowerCase();
  const canal = orden.canal?.trim().toLowerCase();
  return proveedor === "local" || canal === "admin" || canal === "vendedor";
}

function itemSubtotalLabel(item: NonNullable<OrdenVendedorDetalle["items"]>[number]): string {
  return item.modo_compra === "dinero" ? compactMoney(item.subtotal_dinero) : `${item.subtotal_puntos} pts`;
}

function staffBackRoute(pathname: string): string {
  if (pathname.startsWith("/superadmin/")) return "/superadmin/ventas/pedidos";
  if (pathname.startsWith("/admin/")) return "/admin/ventas/pedidos";
  return "/vendedor/ventas/pedidos";
}

export function ComprobantePedidoVendedor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backRoute = staffBackRoute(location.pathname);

  const { data: orden, isLoading, isError } = useQuery({
    queryKey: ["vendedor", "orden", id],
    queryFn: () => api.get<OrdenVendedorDetalle>(`/vendedor/ordenes/${id}`),
    enabled: !!id,
    retry: false,
  });

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  useEffect(() => {
    document.body.dataset.printFormat = "ticket";

    let style = document.getElementById(PRINT_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = PRINT_STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = "@media print { @page { size: 58mm auto; margin: 0; } }";

    return () => {
      delete document.body.dataset.printFormat;
      style?.remove();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="comprobante-wrapper comprobante-wrapper-ticket">
        <p>Cargando comprobante...</p>
      </div>
    );
  }

  if (isError || !orden) {
    return (
      <div className="comprobante-wrapper comprobante-wrapper-ticket">
        <div className="status-err-box" style={{ maxWidth: "400px", margin: "2rem auto" }}>
          <p>No se pudo cargar el comprobante del pedido.</p>
        </div>
        <button className="catalog-float-toast-btn-secondary" onClick={() => navigate(backRoute)}>
          Volver a pedidos
        </button>
      </div>
    );
  }

  const isLocalSale = isLocalSaleOrder(orden);
  const clienteNombre = orden.direccion_envio?.nombre || orden.usuario?.nombre || "-";
  const clienteDni = orden.usuario?.dni || "-";
  const clienteTelefono = orden.direccion_envio?.telefono || orden.usuario?.telefono || "-";
  const costoEnvio = Number(orden.direccion_envio?.costo_envio ?? orden.direccion_envio?.envio?.costo_envio ?? 0);
  const subtotalProductosDinero = orden.items?.length
    ? orden.items.reduce((acc, item) => acc + (item.modo_compra === "dinero" ? Number(item.subtotal_dinero || 0) : 0), 0)
    : Math.max(0, Number(orden.total_dinero || 0) - costoEnvio);
  const puntosGanados =
    orden.items?.reduce((acc, item) => acc + Number(item.puntaje_al_comprar_unitario || 0) * Number(item.cantidad || 0), 0) || 0;
  const receiptTitle = isLocalSale ? "Comprobante de venta local" : "Comprobante de pedido";
  const orderLabel = isLocalSale ? `Venta local #${orden.id}` : `Pedido web #${orden.id}`;

  return (
    <div className="comprobante-wrapper comprobante-wrapper-ticket">
      <div className="comprobante-actions comprobante-actions-ticket no-print">
        <Link to={backRoute} className="catalog-float-toast-btn-secondary" style={{ padding: "0.5rem 1rem", height: "auto" }}>
          Volver
        </Link>
        <button
          type="button"
          className="catalog-float-toast-btn-primary"
          style={{ padding: "0.5rem 1rem", height: "auto" }}
          onClick={() => window.print()}
        >
          Imprimir 58mm
        </button>
      </div>

      <div className="comprobante-ticket comprobante-print-target">
        <p className="comprobante-ticket-center comprobante-ticket-legal">NO VALIDO COMO FACTURA</p>
        <div className="comprobante-ticket-divider" />

        <div className="comprobante-ticket-header">
          <p className="comprobante-ticket-brand">NANDE</p>
          <p className="comprobante-ticket-title">{receiptTitle}</p>
        </div>

        <div className="comprobante-ticket-divider" />

        <div className="comprobante-ticket-block">
          <p><strong>FECHA:</strong> {dateLabel(orden.created_at)}</p>
          <p><strong>COMPROBANTE:</strong> {orderLabel}</p>
          <p><strong>CLIENTE:</strong> {clienteNombre}</p>
          {clienteDni !== "-" ? <p><strong>DNI:</strong> {clienteDni}</p> : null}
          {clienteTelefono !== "-" ? <p><strong>TEL:</strong> {clienteTelefono}</p> : null}
          <p><strong>PAGO:</strong> {paymentMethodLabel(orden.pago?.metodo)}</p>
          <p><strong>PROVEEDOR:</strong> {paymentProviderLabel(orden.pago?.proveedor)}</p>
          <p><strong>CANAL:</strong> {canalLabel(orden.canal)}</p>
          <p><strong>ESTADO:</strong> {estadoPedidoLabel(orden.estado)}</p>
        </div>

        <div className="comprobante-ticket-divider" />

        <div className="comprobante-ticket-head">
          <div>
            <p>Cant./Precio Unit.</p>
            <p>Descripcion</p>
          </div>
          <span>Importe</span>
        </div>

        {orden.items?.map((item, idx) => (
          <div key={`${item.producto_id}-${idx}`} className="comprobante-ticket-item">
            <div className="comprobante-ticket-row comprobante-ticket-item-top">
              <span>{item.cantidad} x {compactMoney(item.precio_dinero_unit)}</span>
              <span>{itemSubtotalLabel(item)}</span>
            </div>
            <p className="comprobante-ticket-item-name">{item.nombre}</p>
            {item.sabores?.length ? (
              <div className="comprobante-ticket-flavors">
                {item.sabores.map((sabor, saborIndex) => (
                  <p key={`${item.producto_id}-${sabor.sabor_id}-${saborIndex}`}>- {sabor.nombre} x{sabor.cantidad}</p>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        <div className="comprobante-ticket-divider" />

        <div className="comprobante-ticket-block">
          <div className="comprobante-ticket-row">
            <span>Subtotal</span>
            <span>{compactMoney(subtotalProductosDinero)}</span>
          </div>
          {costoEnvio > 0 ? (
            <div className="comprobante-ticket-row">
              <span>Envio</span>
              <span>{compactMoney(costoEnvio)}</span>
            </div>
          ) : null}
          {orden.total_puntos > 0 ? (
            <div className="comprobante-ticket-row">
              <span>Puntos usados</span>
              <span>{orden.total_puntos} pts</span>
            </div>
          ) : null}
          {puntosGanados > 0 ? (
            <div className="comprobante-ticket-row">
              <span>Puntos ganados</span>
              <span>+{puntosGanados} pts</span>
            </div>
          ) : null}
          <div className="comprobante-ticket-row comprobante-ticket-total">
            <span>TOTAL</span>
            <span>{compactMoney(orden.total_dinero)}</span>
          </div>
        </div>

        <div className="comprobante-ticket-divider" />

        <div className="comprobante-ticket-block">
          {orden.sucursal?.nombre ? <p><strong>SUCURSAL:</strong> {orden.sucursal.nombre}</p> : null}
          {orden.sucursal?.direccion ? (
            <p>
              <strong>DIRECCION:</strong> {orden.sucursal.direccion}
              {orden.sucursal.localidad ? `, ${orden.sucursal.localidad}` : ""}
              {orden.sucursal.provincia ? `, ${orden.sucursal.provincia}` : ""}
            </p>
          ) : null}
          {orden.direccion_envio?.direccion ? (
            <p>
              <strong>ENTREGA:</strong> {orden.direccion_envio.direccion}
              {orden.direccion_envio.localidad ? `, ${orden.direccion_envio.localidad}` : ""}
              {orden.direccion_envio.provincia ? `, ${orden.direccion_envio.provincia}` : ""}
            </p>
          ) : null}
          {orden.notas ? <p><strong>NOTAS:</strong> {orden.notas}</p> : null}
        </div>

        <div className="comprobante-ticket-divider" />
        <p className="comprobante-ticket-center comprobante-ticket-muted">Gracias por elegir Nande.</p>
        <p className="comprobante-ticket-center comprobante-ticket-legal">NO VALIDO COMO FACTURA</p>
      </div>
    </div>
  );
}
