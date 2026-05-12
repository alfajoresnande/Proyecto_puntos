import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import { useAuthStore } from "../../store/authStore";
import "../../styles/comprobante.css";
import { useEffect } from "react";

type CanjeDetalle = {
  id: number;
  codigo_retiro?: string | null;
  puntos_usados: number;
  estado: "pendiente" | "entregado" | "no_disponible" | "expirado" | "cancelado";
  fecha_limite_retiro: string | null;
  notas: string | null;
  created_at: string;
  producto_nombre: string;
  producto_imagen: string | null;
  items?: Array<{
    producto_id: number;
    producto_nombre: string;
    producto_imagen: string | null;
    cantidad: number;
    puntos_unitarios: number;
    puntos_total: number;
  }>;
  sucursal_id?: number | null;
  sucursal_nombre?: string | null;
  sucursal_direccion?: string | null;
  sucursal_piso?: string | null;
  sucursal_localidad?: string | null;
  sucursal_provincia?: string | null;
};

function dateLabel(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function estadoCanjeLabel(estado: CanjeDetalle["estado"]): string {
  if (estado === "no_disponible") return "No disponible";
  if (estado === "expirado") return "Expirado";
  if (estado === "pendiente") return "Pendiente de retiro";
  if (estado === "entregado") return "Entregado";
  if (estado === "cancelado") return "Cancelado";
  return estado;
}

export function ComprobanteCanje() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const { data: canje, isLoading, isError } = useQuery({
    queryKey: ["cliente", "canje", id],
    queryFn: () => api.get<CanjeDetalle>(`/cliente/canjes/${id}`),
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

  if (isError || !canje) {
    return (
      <div className="comprobante-wrapper">
        <div className="status-err-box" style={{ maxWidth: "400px", margin: "2rem auto" }}>
          <p>No se pudo cargar el canje. Verifica que exista y te pertenezca.</p>
        </div>
        <button className="catalog-float-toast-btn-secondary" onClick={() => navigate("/mis-canjes")}>
          Volver a mis canjes
        </button>
      </div>
    );
  }

  const clienteNombre = user?.nombre || "-";
  const clienteEmail = user?.email || "-";
  const clienteDni = user?.dni || "-";
  
  const displayItems = canje.items || [{
    producto_id: 0,
    producto_nombre: canje.producto_nombre,
    producto_imagen: canje.producto_imagen,
    cantidad: 1,
    puntos_unitarios: Number(canje.puntos_usados),
    puntos_total: Number(canje.puntos_usados),
  }];

  return (
    <div className="comprobante-wrapper">
      <div className="comprobante-actions no-print">
        <Link to="/mis-canjes" className="catalog-float-toast-btn-secondary" style={{ padding: "0.5rem 1rem", height: "auto" }}>
          Volver
        </Link>
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
            <h1 className="comprobante-title">Comprobante de canje</h1>
            <p><strong>Canje web #{canje.id}</strong></p>
            <p>{dateLabel(canje.created_at)}</p>
          </div>
        </div>

        <div className="comprobante-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div className="comprobante-box">
            <h3>Datos del Cliente</h3>
            <p><strong>Nombre:</strong> {clienteNombre}</p>
            <p><strong>Email:</strong> {clienteEmail}</p>
            <p><strong>DNI:</strong> {clienteDni}</p>
          </div>

          <div className="comprobante-box">
            <h3>Resumen del canje</h3>
            <p><strong>Estado:</strong> {estadoCanjeLabel(canje.estado)}</p>
            <p><strong>Código de retiro:</strong> <span style={{ color: "#D4621A", fontWeight: "bold" }}>{canje.codigo_retiro || "Generando..."}</span></p>
            {canje.fecha_limite_retiro && (
              <p><strong>Límite de retiro:</strong> {dateLabel(canje.fecha_limite_retiro)}</p>
            )}
            <p><strong>Puntos usados:</strong> {canje.puntos_usados} pts</p>
          </div>

          <div className="comprobante-box">
            <h3>Lugar de retiro</h3>
            {canje.sucursal_nombre ? (
              <>
                <p><strong>Sucursal:</strong> {canje.sucursal_nombre}</p>
                <p><strong>Dirección:</strong> {canje.sucursal_direccion}, {canje.sucursal_localidad}, {canje.sucursal_provincia}</p>
                {canje.sucursal_piso && <p><strong>Piso:</strong> {canje.sucursal_piso}</p>}
              </>
            ) : (
              <p><strong>Forma:</strong> A convenir o Envío</p>
            )}
            {canje.notas && <p style={{ marginTop: "0.5rem" }}><strong>Nota:</strong> {canje.notas}</p>}
          </div>
        </div>

        <div className="comprobante-table-wrapper">
          <table className="comprobante-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Producto</th>
                <th className="text-center" style={{ width: "80px" }}>Cant.</th>
                <th className="text-right" style={{ width: "120px" }}>Puntos Un.</th>
                <th className="text-right" style={{ width: "120px" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, idx) => (
                <tr key={`${item.producto_id}-${idx}`}>
                  <td>{item.producto_nombre}</td>
                  <td className="text-center">{item.cantidad}</td>
                  <td className="text-right">{item.puntos_unitarios} pts</td>
                  <td className="text-right">{item.puntos_total} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="comprobante-totals">
          <div className="comprobante-total-row grand-total" style={{ borderTop: "2px solid #e5e7eb", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
            <span>Total Puntos:</span>
            <span>{canje.puntos_usados} pts</span>
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
