import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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

type PrintFormat = "a4" | "ticket";

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

function itemUnitLabel(item: NonNullable<OrdenVendedorDetalle["items"]>[number]): string {
  return item.modo_compra === "dinero" ? money(item.precio_dinero_unit) : `${item.subtotal_puntos} pts`;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const backRoute = staffBackRoute(location.pathname);

  const { data: orden, isLoading, isError } = useQuery({
    queryKey: ["vendedor", "orden", id],
    queryFn: () => api.get<OrdenVendedorDetalle>(`/vendedor/ordenes/${id}`),
    enabled: !!id,
    retry: false,
  });

  const printFormat: PrintFormat = searchParams.get("formato") === "ticket" ? "ticket" : "a4";

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  useEffect(() => {
    document.body.dataset.printFormat = printFormat;

    let style = document.getElementById(PRINT_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = PRINT_STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent =
      printFormat === "ticket"
        ? "@media print { @page { size: 58mm auto; margin: 0; } }"
        : "@media print { @page { size: A4; margin: 12mm; } }";

    return () => {
      delete document.body.dataset.printFormat;
      style?.remove();
    };
  }, [printFormat]);

  if (isLoading) {
    return (
      <div className="comprobante-wrapper">
        <p>Cargando comprobante...</p>
      </div>
    );
  }

  if (isError || !orden) {
    return (
      <div className="comprobante-wrapper">
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
  const clienteEmail = orden.usuario?.email || "-";
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

  function updatePrintFormat(nextFormat: PrintFormat) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextFormat === "ticket") {
      nextParams.set("formato", "ticket");
    } else {
      nextParams.delete("formato");
    }
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <div className={`comprobante-wrapper ${printFormat === "ticket" ? "comprobante-wrapper-ticket" : ""}`}>
      <div className={`comprobante-actions ${printFormat === "ticket" ? "comprobante-actions-ticket" : ""} no-print`}>
        <Link to={backRoute} className="catalog-float-toast-btn-secondary" style={{ padding: "0.5rem 1rem", height: "auto" }}>
          Volver
        </Link>
        <button
          type="button"
          className={printFormat === "a4" ? "catalog-float-toast-btn-primary" : "catalog-float-toast-btn-secondary"}
          style={{ padding: "0.5rem 1rem", height: "auto" }}
          onClick={() => updatePrintFormat("a4")}
        >
          Vista normal
        </button>
        <button
          type="button"
          className={printFormat === "ticket" ? "catalog-float-toast-btn-primary" : "catalog-float-toast-btn-secondary"}
          style={{ padding: "0.5rem 1rem", height: "auto" }}
          onClick={() => updatePrintFormat("ticket")}
        >
          Vista 58mm
        </button>
        <button
          type="button"
          className="catalog-float-toast-btn-primary"
          style={{ padding: "0.5rem 1rem", height: "auto" }}
          onClick={() => window.print()}
        >
          {printFormat === "ticket" ? "Imprimir 58mm" : "Imprimir A4"}
        </button>
      </div>

      {printFormat === "ticket" ? (
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
      ) : (
        <div className="comprobante-a4 comprobante-print-target">
          <div className="comprobante-header">
            <div className="comprobante-logo-container">
              <img src="/logo.png" alt="Nande" className="comprobante-logo" />
            </div>
            <div className="comprobante-meta">
              <h1 className="comprobante-title">{receiptTitle}</h1>
              <p><strong>{orderLabel}</strong></p>
              <p>{dateLabel(orden.created_at)}</p>
            </div>
          </div>

          <div className="comprobante-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <div className="comprobante-box">
              <h3>Datos del cliente</h3>
              <p><strong>Nombre:</strong> {clienteNombre}</p>
              <p><strong>Email:</strong> {clienteEmail}</p>
              <p><strong>DNI:</strong> {clienteDni}</p>
              {clienteTelefono !== "-" ? <p><strong>Telefono:</strong> {clienteTelefono}</p> : null}
            </div>

            <div className="comprobante-box">
              <h3>Resumen de pago</h3>
              <p><strong>Estado:</strong> {estadoPedidoLabel(orden.estado)}</p>
              <p><strong>Metodo de pago:</strong> {paymentMethodLabel(orden.pago?.metodo)}</p>
              <p><strong>Proveedor:</strong> {paymentProviderLabel(orden.pago?.proveedor)}</p>
              <p><strong>Canal:</strong> {canalLabel(orden.canal)}</p>
              <p><strong>Total:</strong> {money(orden.pago?.monto || orden.total_dinero)}</p>
            </div>

            <div className="comprobante-box">
              <h3>{orden.direccion_envio ? "Detalles de entrega" : "Sucursal"}</h3>
              {orden.direccion_envio ? (
                <>
                  <p><strong>Forma:</strong> Envio a domicilio</p>
                  <p><strong>Direccion:</strong> {orden.direccion_envio.direccion}</p>
                  <p><strong>Localidad:</strong> {orden.direccion_envio.localidad}, {orden.direccion_envio.provincia} ({orden.direccion_envio.codigo_postal})</p>
                  {orden.direccion_envio.referencias ? <p><strong>Referencias:</strong> {orden.direccion_envio.referencias}</p> : null}
                  {orden.direccion_envio.envio?.zona_nombre ? <p><strong>Zona:</strong> {orden.direccion_envio.envio.zona_nombre}</p> : null}
                </>
              ) : orden.sucursal?.nombre ? (
                <>
                  <p><strong>Forma:</strong> Retiro en sucursal</p>
                  <p><strong>Sucursal:</strong> {orden.sucursal.nombre}</p>
                  <p><strong>Direccion:</strong> {orden.sucursal.direccion}, {orden.sucursal.localidad}, {orden.sucursal.provincia}</p>
                </>
              ) : (
                <p><strong>Forma:</strong> A convenir</p>
              )}
            </div>
          </div>

          {orden.items && orden.items.length > 0 ? (
            <div className="comprobante-table-wrapper">
              <table className="comprobante-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Producto</th>
                    <th className="text-center" style={{ width: "80px" }}>Cant.</th>
                    <th className="text-right" style={{ width: "120px" }}>Precio un.</th>
                    <th className="text-right" style={{ width: "120px" }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {orden.items.map((item, idx) => (
                    <tr key={`${item.producto_id}-${idx}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.nombre}</div>
                        {item.sabores?.length ? (
                          <div className="comprobante-item-sabores">
                            {item.sabores.map((sabor, saborIndex) => (
                              <div key={`${item.producto_id}-${sabor.sabor_id}-${saborIndex}`} className="comprobante-item-sabor">
                                - {sabor.nombre} (x{sabor.cantidad})
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-center">{item.cantidad}</td>
                      <td className="text-right">{itemUnitLabel(item)}</td>
                      <td className="text-right">{money(item.subtotal_dinero)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="comprobante-totals">
            <div className="comprobante-total-row">
              <span>Subtotal productos:</span>
              <span>{money(subtotalProductosDinero)}</span>
            </div>
            {costoEnvio > 0 ? (
              <div className="comprobante-total-row">
                <span>Envio:</span>
                <span>{money(costoEnvio)}</span>
              </div>
            ) : null}
            {orden.total_puntos > 0 ? (
              <div className="comprobante-total-row">
                <span>Puntos usados:</span>
                <span>{orden.total_puntos} pts</span>
              </div>
            ) : null}
            {puntosGanados > 0 ? (
              <div className="comprobante-total-row">
                <span>Puntos ganados:</span>
                <span style={{ color: "#D4621A", fontWeight: 600 }}>+{puntosGanados} pts</span>
              </div>
            ) : null}
            <div className="comprobante-total-row grand-total">
              <span>Total:</span>
              <span>{money(orden.total_dinero)}</span>
            </div>
          </div>

          <div className="comprobante-footer">
            <p className="comprobante-disclaimer">Este documento no es valido como factura.</p>
            <p className="comprobante-thanks">Gracias por elegir Nande Alfajores Correntinos.</p>
          </div>
        </div>
      )}
    </div>
  );
}
