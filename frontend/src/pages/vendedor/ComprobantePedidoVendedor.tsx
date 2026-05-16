import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { formatBuenosAiresDateTime } from "../../lib/dateTime";
import "../../styles/comprobante.css";

type OrdenVendedorDetalle = {
  id: number;
  estado: string;
  tipo_orden: "venta" | "mixta" | string;
  total_dinero: number;
  total_puntos: number;
  moneda: string;
  created_at: string;
  direccion_envio?: {
    nombre?: string;
    telefono?: string;
    direccion?: string;
    codigo_postal?: string;
    localidad?: string;
    provincia?: string;
    referencias?: string | null;
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

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
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
    pagada: "Pago aprobado",
    preparada: "Preparando pedido",
    enviada: "En camino",
    entregada: "Entregado",
    cancelada: "Cancelado",
    expirada: "Expirado",
  };
  return labels[estado.trim().toLowerCase()] ?? estado;
}

function paymentMethodLabel(metodo: string | null | undefined): string {
  const normalized = (metodo || "").trim().toLowerCase();
  if (normalized === "cash" || normalized === "efectivo") return "Efectivo al retirar";
  if (normalized === "wallet") return "Mercado Pago";
  if (normalized === "qr") return "Mercado Pago QR";
  if (normalized === "brick") return "Tarjeta";
  return "Sin definir";
}

function paymentProviderLabel(proveedor: string | null | undefined): string {
  const normalized = (proveedor || "").trim().toLowerCase();
  if (normalized === "mercadopago") return "Mercado Pago";
  if (normalized === "cash" || normalized === "efectivo") return "Efectivo";
  return proveedor || "Sin definir";
}

export function ComprobantePedidoVendedor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
        <button className="catalog-float-toast-btn-secondary" onClick={() => navigate("/vendedor/pedidos")}>
          Volver a pedidos
        </button>
      </div>
    );
  }

  const clienteNombre = orden.direccion_envio?.nombre || orden.usuario?.nombre || "-";
  const clienteEmail = orden.usuario?.email || "-";
  const clienteDni = orden.usuario?.dni || "-";
  const clienteTelefono = orden.direccion_envio?.telefono || orden.usuario?.telefono || "-";
  const puntosGanados =
    orden.items?.reduce((acc, item) => acc + Number(item.puntaje_al_comprar_unitario || 0) * Number(item.cantidad || 0), 0) || 0;

  return (
    <div className="comprobante-wrapper">
      <div className="comprobante-actions no-print">
        <Link to="/vendedor/pedidos" className="catalog-float-toast-btn-secondary" style={{ padding: "0.5rem 1rem", height: "auto" }}>
          Volver
        </Link>
      </div>

      <div className="comprobante-a4">
        <div className="comprobante-header">
          <div className="comprobante-logo-container">
            <img src="/logo.png" alt="Nande" className="comprobante-logo" />
          </div>
          <div className="comprobante-meta">
            <h1 className="comprobante-title">Comprobante de pedido</h1>
            <p><strong>Pedido web #{orden.id}</strong></p>
            <p>{dateLabel(orden.created_at)}</p>
          </div>
        </div>

        <div className="comprobante-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div className="comprobante-box">
            <h3>Datos del Cliente</h3>
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
            <p><strong>Total:</strong> {money(orden.pago?.monto || orden.total_dinero)}</p>
          </div>

          <div className="comprobante-box">
            <h3>Detalles de entrega</h3>
            {orden.direccion_envio ? (
              <>
                <p><strong>Forma:</strong> Envio a domicilio</p>
                <p><strong>Direccion:</strong> {orden.direccion_envio.direccion}</p>
                <p><strong>Localidad:</strong> {orden.direccion_envio.localidad}, {orden.direccion_envio.provincia} ({orden.direccion_envio.codigo_postal})</p>
                {orden.direccion_envio.referencias ? <p><strong>Referencias:</strong> {orden.direccion_envio.referencias}</p> : null}
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
                  <th className="text-right" style={{ width: "120px" }}>Precio Un.</th>
                  <th className="text-right" style={{ width: "120px" }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {orden.items.map((item, idx) => (
                  <tr key={`${item.producto_id}-${idx}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.nombre}</div>
                      {item.sabores && item.sabores.length > 0 && (
                        <div className="comprobante-item-sabores">
                          {item.sabores.map((s, sidx) => (
                            <div key={sidx} className="comprobante-item-sabor">
                              • {s.nombre} (x{s.cantidad})
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-center">{item.cantidad}</td>
                    <td className="text-right">{item.modo_compra === "dinero" ? money(item.precio_dinero_unit) : `${item.subtotal_puntos} pts`}</td>
                    <td className="text-right">{item.modo_compra === "dinero" ? money(item.subtotal_dinero) : `${item.subtotal_puntos} pts`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="comprobante-totals">
          <div className="comprobante-total-row">
            <span>Subtotal:</span>
            <span>{money(orden.total_dinero)}</span>
          </div>
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
    </div>
  );
}
