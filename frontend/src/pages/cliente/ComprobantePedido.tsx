import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";
import "../../styles/comprobante.css";
import { useEffect } from "react";

type OrdenDetalle = {
  id: number;
  estado: string;
  tipo_orden: "canje" | "venta" | "mixta";
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
    puntaje_al_comprar_unitario?: number | null;
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
  usuario?: {
    nombre: string;
    email: string;
    dni: string | null;
  };
};

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
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

function canContinueOnlinePayment(orden: OrdenDetalle): boolean {
  return (
    orden.estado === "pendiente_pago" &&
    orden.pago?.proveedor === "mercadopago" &&
    orden.pago?.estado === "iniciado"
  );
}

export function ComprobantePedido() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const { data: orden, isLoading, isError } = useQuery({
    queryKey: ["cliente", "orden", id],
    queryFn: () => api.get<OrdenDetalle>(`/cliente/ordenes/${id}`),
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
          <p>No se pudo cargar el pedido. Verifica que exista y te pertenezca.</p>
        </div>
        <button className="catalog-float-toast-btn-secondary" onClick={() => navigate("/mis-pedidos")}>
          Volver a mis pedidos
        </button>
      </div>
    );
  }

  const clienteNombre = orden.direccion_envio?.nombre || user?.nombre || "-";
  const clienteEmail = user?.email || "-";
  const clienteDni = user?.dni || "-";
  const clienteTelefono = orden.direccion_envio?.telefono || "-";
  
  const puntosGanados = orden.items?.reduce((acc, item) => acc + (item.puntaje_al_comprar_unitario || 0) * item.cantidad, 0) || 0;

  return (
    <div className="comprobante-wrapper">
      <div className="comprobante-actions no-print">
        <Link to="/mis-pedidos" className="catalog-float-toast-btn-secondary" style={{ padding: "0.5rem 1rem", height: "auto" }}>
          Volver
        </Link>
        {canContinueOnlinePayment(orden) ? (
          <Link
            to={`/carrito-tienda?pagar_orden=${orden.id}`}
            className="catalog-float-toast-btn-primary"
            style={{ padding: "0.5rem 1rem", height: "auto" }}
          >
            Continuar pago
          </Link>
        ) : null}
        <button 
          className="catalog-float-toast-btn-primary" 
          style={{ padding: "0.5rem 1rem", height: "auto" }}
          onClick={() => window.print()}
        >
          Imprimir / Descargar PDF
        </button>
      </div>

      <div className="comprobante-a4">
        <div className="comprobante-header">
          <div className="comprobante-logo-container">
            <img src="/logo.png" alt="Ñandé" className="comprobante-logo" />
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
            {clienteTelefono !== "-" && <p><strong>Teléfono:</strong> {clienteTelefono}</p>}
          </div>

          <div className="comprobante-box">
            <h3>Resumen de pago</h3>
            <p><strong>Estado:</strong> {estadoPedidoLabel(orden.estado)}</p>
            <p><strong>Método de pago:</strong> {paymentMethodLabel(orden.pago?.metodo)}</p>
            <p><strong>Proveedor:</strong> {paymentProviderLabel(orden.pago?.proveedor)}</p>
            <p><strong>Total pagado:</strong> {money(orden.pago?.monto || orden.total_dinero)}</p>
          </div>

          <div className="comprobante-box">
            <h3>Detalles de entrega</h3>
            {orden.direccion_envio ? (
              <>
                <p><strong>Forma:</strong> Envío a domicilio</p>
                <p><strong>Dirección:</strong> {orden.direccion_envio.direccion}</p>
                <p><strong>Localidad:</strong> {orden.direccion_envio.localidad}, {orden.direccion_envio.provincia} ({orden.direccion_envio.codigo_postal})</p>
              </>
            ) : orden.sucursal?.nombre ? (
              <>
                <p><strong>Forma:</strong> Retiro en sucursal</p>
                <p><strong>Sucursal:</strong> {orden.sucursal.nombre}</p>
                <p><strong>Dirección:</strong> {orden.sucursal.direccion}, {orden.sucursal.localidad}, {orden.sucursal.provincia}</p>
                {orden.comprobante?.horario_habil && <p><strong>Horario:</strong> {orden.comprobante.horario_habil}</p>}
              </>
            ) : (
              <p><strong>Forma:</strong> A convenir</p>
            )}
          </div>
        </div>

        {orden.items && orden.items.length > 0 && (
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
                    <td>{item.nombre}</td>
                    <td className="text-center">{item.cantidad}</td>
                    <td className="text-right">{money(item.precio_dinero_unit)}</td>
                    <td className="text-right">{money(item.subtotal_dinero)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="comprobante-totals">
          <div className="comprobante-total-row">
            <span>Subtotal:</span>
            <span>{money(orden.total_dinero)}</span>
          </div>
          {orden.total_puntos > 0 && (
            <div className="comprobante-total-row">
              <span>Puntos usados:</span>
              <span>{orden.total_puntos} pts</span>
            </div>
          )}
          {puntosGanados > 0 && (
            <div className="comprobante-total-row">
              <span>Puntos ganados:</span>
              <span style={{ color: "#D4621A", fontWeight: 600 }}>+{puntosGanados} pts</span>
            </div>
          )}
          <div className="comprobante-total-row grand-total">
            <span>Total:</span>
            <span>{money(orden.total_dinero)}</span>
          </div>
        </div>

        <div className="comprobante-footer">
          <p className="comprobante-disclaimer">Este documento no es válido como factura.</p>
          <p className="comprobante-thanks">Gracias por elegir Ñandé Alfajores Correntinos.</p>
        </div>
      </div>
    </div>
  );
}
