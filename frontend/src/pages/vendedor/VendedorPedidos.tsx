import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { CatalogPagination } from "../../components/CatalogPagination";
import { formatBuenosAiresDateTime } from "../../lib/dateTime";
import {
  getLocalSaleQuickProductImage,
  getLocalSaleQuickProductSubtitle,
} from "../../lib/localSaleQuickProducts";
import type { Producto } from "../../types";
import "../../styles/vendedor-ventas.css";

type ClienteBuscado = {
  id: number;
  nombre: string;
  dni: string;
  email: string;
  puntos: number;
  tipo_cliente?: "cliente" | "mayorista" | "empleado";
  descuento_porcentaje?: number;
};

type SucursalPublica = {
  id: number;
  nombre: string;
  direccion: string;
  piso?: string | null;
  localidad: string;
  provincia: string;
};

type VentaLocalItemDraft = {
  producto_id: number;
  nombre: string;
  cantidad: number;
  precio_dinero: number;
  sabores?: Array<{
    sabor_id: number;
    nombre: string;
    cantidad: number;
  }>;
};

type OrdenVendedor = {
  id: number;
  usuario_id?: number | null;
  cliente_local_id?: number | null;
  canal: "web" | "admin" | "vendedor";
  cliente_nombre: string;
  cliente_email: string;
  cliente_dni?: string | null;
  cliente_telefono?: string | null;
  estado: "pendiente_pago" | "pagada" | "preparandose" | "preparada" | "enviada" | "entregando" | "entregada" | "cancelada" | "expirada" | string;
  tipo_orden: "venta" | "mixta" | string;
  total_dinero: number;
  total_puntos: number;
  total_unidades: number;
  created_at: string;
  notas?: string | null;
  puntos_acreditados?: boolean;
  direccion_envio?: {
    nombre?: string;
    telefono?: string;
    direccion?: string;
    direccion_formateada?: string;
    codigo_postal?: string;
    localidad?: string;
    provincia?: string;
    referencias?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
  sucursal?: {
    id?: number | null;
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
};

type ProveedorVendedor = {
  id: number;
  nombre: string;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
  notas?: string | null;
};

type CajaSesionVendedor = {
  id: number;
  sucursal_id: number;
  sucursal_nombre: string;
  fecha_operativa: string;
  estado: "abierta" | "cerrada";
  monto_apertura: number;
  monto_cierre_sistema: number | null;
  monto_cierre_declarado: number | null;
  diferencia_cierre: number | null;
  apertura_at: string;
  cierre_at: string | null;
  summary: {
    totalVentas: number;
    totalGastos: number;
    neto: number;
    efectivoSistema: number;
    ventasPorMedio: Record<string, number>;
    gastosPorMedio: Record<string, number>;
    cantidadMovimientos: number;
  };
};

type GastoVendedor = {
  id: number;
  sucursal_id: number;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  tercero_nombre: string | null;
  categoria: string;
  descripcion: string;
  medio_pago: string;
  monto: number;
  notas?: string | null;
};

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function emptyZeroInputValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (!stringValue.trim()) return "";
  const numericValue = Number(stringValue);
  if (!Number.isFinite(numericValue) || numericValue === 0) return "";
  return stringValue;
}

function formatDate(value: string): string {
  return formatBuenosAiresDateTime(value);
}

function estadoOrdenLabel(estado: string): string {
  const labels: Record<string, string> = {
    pendiente_pago: "Pendiente pago",
    pagada: "Pagada",
    preparandose: "Preparandose",
    preparada: "Preparada",
    enviada: "Enviada",
    entregando: "Entregando",
    entregada: "Entregada",
    cancelada: "Cancelada",
    expirada: "Expirada",
  };
  return labels[estado] ?? estado.replace(/_/g, " ");
}

function canalLabel(canal: string): string {
  const labels: Record<string, string> = {
    web: "Web",
    admin: "Local admin",
    vendedor: "Local vendedor",
  };
  return labels[canal] ?? canal;
}

function metodoPagoLabel(metodo?: string | null): string {
  const labels: Record<string, string> = {
    cash: "Efectivo",
    transferencia: "Transferencia",
    tarjeta: "Tarjeta",
    qr: "QR",
    otro: "Otro",
  };
  return metodo ? labels[metodo] ?? metodo : "";
}

function pagoLabel(pago: OrdenVendedor["pago"]): string {
  if (!pago) return "Sin pago";
  const metodo = pago.proveedor === "local"
    ? metodoPagoLabel(pago.metodo)
    : pago.metodo === "cash" ? "Efectivo" : pago.metodo === "brick" ? "Tarjeta" : pago.metodo === "qr" ? "QR" : pago.metodo || pago.proveedor;
  const estado = pago.estado === "iniciado" ? "pendiente" : pago.estado;
  return `${metodo} / ${estado}`;
}

function hasOrderMapPoint(address: OrdenVendedor["direccion_envio"]): boolean {
  if (!address) return false;
  const lat = Number(address.lat);
  const lng = Number(address.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function sanitizeManualDni(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

function sanitizeManualPhone(value: string): string {
  return value.replace(/[^0-9+()\-\s]/g, "").slice(0, 25);
}

function validateManualDni(value: string): boolean {
  return /^\d{6,10}$/.test(value.trim());
}

function validateManualPhone(value: string): boolean {
  const phone = value.trim();
  if (!phone) return true;
  if (!/^[0-9+()\-\s]+$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

function extractEditableSaleNotes(value?: string | null): string {
  return String(value ?? "")
    .replace(/^Venta local (registrada|actualizada) desde panel (admin|vendedor)\.\s*/i, "")
    .trim();
}

function normalizeVentaDraftSabores(
  sabores?: Array<{
    sabor_id: number;
    nombre: string;
    cantidad: number;
  }>,
): Array<{
  sabor_id: number;
  nombre: string;
  cantidad: number;
}> {
  return [...(sabores ?? [])]
    .filter((sabor) => Number(sabor.cantidad) > 0)
    .sort((a, b) => Number(a.sabor_id) - Number(b.sabor_id));
}

function sameVentaDraftSabores(
  left?: Array<{ sabor_id: number; cantidad: number }>,
  right?: Array<{ sabor_id: number; cantidad: number }>,
): boolean {
  const normalizedLeft = normalizeVentaDraftSabores(left as Array<{ sabor_id: number; nombre: string; cantidad: number }> | undefined);
  const normalizedRight = normalizeVentaDraftSabores(right as Array<{ sabor_id: number; nombre: string; cantidad: number }> | undefined);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((sabor, index) => (
    Number(sabor.sabor_id) === Number(normalizedRight[index]?.sabor_id)
    && Number(sabor.cantidad) === Number(normalizedRight[index]?.cantidad)
  ));
}

function isGenericLocalOrderCustomer(orden: OrdenVendedor): boolean {
  return !orden.usuario_id && orden.cliente_nombre.trim().toLowerCase() === "cliente" && String(orden.cliente_dni ?? "").trim() === "00000000";
}

type VendedorVentasPage = "pedidos" | "local" | "caja" | "gastos" | "proveedores";

const ORDENES_POR_PAGINA = 5;

function isVendedorVentasPage(value: string | undefined): value is VendedorVentasPage {
  return value === "pedidos" || value === "local" || value === "caja" || value === "gastos" || value === "proveedores";
}

export function VendedorPedidos() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams<{ ventasPage?: string }>();
  const [searchParams] = useSearchParams();
  const currentPage: VendedorVentasPage = isVendedorVentasPage(params.ventasPage) ? params.ventasPage : "pedidos";
  const [busquedaOrdenes, setBusquedaOrdenes] = useState("");
  const [filtroEstadoOrden, setFiltroEstadoOrden] = useState("");
  const [ordenesPage, setOrdenesPage] = useState(1);
  const [ordenExpandidaId, setOrdenExpandidaId] = useState<number | null>(null);
  const [ordenMsg, setOrdenMsg] = useState("");
  const [ordenErr, setOrdenErr] = useState("");
  const [cancelacionOrden, setCancelacionOrden] = useState<{
    orden: OrdenVendedor;
    motivo: string;
    mensaje_devolucion: string;
  } | null>(null);
  const [ventaClienteQuery, setVentaClienteQuery] = useState("");
  const [ventaCliente, setVentaCliente] = useState<ClienteBuscado | null>(null);
  const [ventaClienteManualNombre, setVentaClienteManualNombre] = useState("");
  const [ventaClienteManualDni, setVentaClienteManualDni] = useState("");
  const [ventaClienteManualTelefono, setVentaClienteManualTelefono] = useState("");
  const [ventaSucursalId, setVentaSucursalId] = useState("");
  const [ventaMetodoPago, setVentaMetodoPago] = useState("cash");
  const [cajaMontoApertura, setCajaMontoApertura] = useState("");
  const [cajaMontoCierre, setCajaMontoCierre] = useState("");
  const [cajaObservacionesApertura, setCajaObservacionesApertura] = useState("");
  const [cajaObservacionesCierre, setCajaObservacionesCierre] = useState("");
  const [gastoProveedorId, setGastoProveedorId] = useState("");
  const [gastoTerceroNombre, setGastoTerceroNombre] = useState("");
  const [gastoCategoria, setGastoCategoria] = useState("");
  const [gastoDescripcion, setGastoDescripcion] = useState("");
  const [gastoMonto, setGastoMonto] = useState("");
  const [gastoMedioPago, setGastoMedioPago] = useState("cash");
  const [gastoNotas, setGastoNotas] = useState("");
  const [nuevoProveedor, setNuevoProveedor] = useState({
    nombre: "",
    contacto: "",
    telefono: "",
    email: "",
    notas: "",
  });
  const [gastoEditId, setGastoEditId] = useState<number | null>(null);
  const [gastoEditDraft, setGastoEditDraft] = useState({
    sucursal_id: "",
    proveedor_id: "",
    tercero_nombre: "",
    categoria: "",
    descripcion: "",
    medio_pago: "cash",
    monto: "",
    notas: "",
  });
  const [proveedorEditId, setProveedorEditId] = useState<number | null>(null);
  const [proveedorEditDraft, setProveedorEditDraft] = useState({
    nombre: "",
    contacto: "",
    telefono: "",
    email: "",
    notas: "",
  });
  const [ventaProductoId, setVentaProductoId] = useState("");
  const [ventaCantidad, setVentaCantidad] = useState("1");
  const [ventaSabores, setVentaSabores] = useState<Record<string, string>>({});
  const [ventaItems, setVentaItems] = useState<VentaLocalItemDraft[]>([]);
  const [ventaProductoBusqueda, setVentaProductoBusqueda] = useState("");
  const [ventaNotas, setVentaNotas] = useState("");
  const [ventaEditId, setVentaEditId] = useState<number | null>(null);

  const ordenesQuery = useQuery({
    queryKey: ["vendedor", "ordenes"],
    queryFn: () => api.get<OrdenVendedor[]>("/vendedor/ordenes"),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const productosLocalesQuery = useQuery({
    queryKey: ["vendedor", "productos-locales", ventaCliente?.id ?? 0],
    queryFn: () => api.get<Producto[]>(`/vendedor/productos-locales${ventaCliente?.id ? `?usuario_id=${ventaCliente.id}` : ""}`),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const sucursalesQuery = useQuery({
    queryKey: ["productos", "sucursales"],
    queryFn: () => api.get<SucursalPublica[]>("/productos/sucursales"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const clientesQuery = useQuery({
    queryKey: ["vendedor", "clientes-locales", ventaClienteQuery.trim()],
    queryFn: () => api.get<ClienteBuscado[]>(`/vendedor/clientes/buscar?q=${encodeURIComponent(ventaClienteQuery.trim())}`),
    enabled: ventaClienteQuery.trim().length >= 2 && !ventaCliente,
  });

  const proveedoresQuery = useQuery({
    queryKey: ["vendedor", "proveedores"],
    queryFn: () => api.get<ProveedorVendedor[]>("/vendedor/proveedores"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const cajaActualQuery = useQuery({
    queryKey: ["vendedor", "caja-actual", ventaSucursalId],
    queryFn: () => api.get<CajaSesionVendedor | null>(`/vendedor/caja/actual?sucursal_id=${Number(ventaSucursalId)}`),
    enabled: Number(ventaSucursalId) > 0,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const gastosQuery = useQuery({
    queryKey: ["vendedor", "gastos", ventaSucursalId],
    queryFn: () => api.get<GastoVendedor[]>(`/vendedor/gastos${ventaSucursalId ? `?sucursal_id=${Number(ventaSucursalId)}` : ""}`),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const ordenes = ordenesQuery.data ?? [];
  const productosLocales = productosLocalesQuery.data ?? [];
  const sucursales = sucursalesQuery.data ?? [];
  const clientesEncontrados = clientesQuery.data ?? [];
  const proveedores = proveedoresQuery.data ?? [];
  const cajaActual = cajaActualQuery.data ?? null;
  const gastos = gastosQuery.data ?? [];
  const ventaEnEdicion = ventaEditId !== null;
  const selectedSucursalValue = ventaSucursalId || (sucursales[0]?.id ? String(sucursales[0].id) : "");

  const productoVentaSeleccionado = useMemo(
    () => productosLocales.find((producto) => Number(producto.id) === Number(ventaProductoId)) ?? null,
    [productosLocales, ventaProductoId],
  );
  const saboresProductoVenta = useMemo(
    () => productoVentaSeleccionado?.configuracion_tipo === "caja_sabores" ? productoVentaSeleccionado.sabores ?? [] : [],
    [productoVentaSeleccionado],
  );
  const totalSaboresVenta = useMemo(
    () => Object.values(ventaSabores).reduce((acc, value) => acc + (Number(value) || 0), 0),
    [ventaSabores],
  );
  const cantidadVentaSeleccionada = useMemo(() => {
    const value = Math.floor(Number(ventaCantidad));
    return Number.isInteger(value) && value > 0 ? value : 0;
  }, [ventaCantidad]);
  const totalAlfajoresVenta = useMemo(() => {
    const capacidad = Number(productoVentaSeleccionado?.capacidad_sabores ?? 0);
    return Math.max(0, capacidad * cantidadVentaSeleccionada);
  }, [cantidadVentaSeleccionada, productoVentaSeleccionado?.capacidad_sabores]);
  const totalVentaLocal = useMemo(
    () => ventaItems.reduce((acc, item) => acc + item.precio_dinero * item.cantidad, 0),
    [ventaItems],
  );
  const productosVentaFiltrados = useMemo(() => {
    const q = ventaProductoBusqueda.trim().toLowerCase();
    if (!q) return productosLocales;
    return productosLocales.filter((producto) => [
      producto.nombre,
      producto.categoria ?? "",
      producto.descripcion ?? "",
    ].some((value) => value.toLowerCase().includes(q)));
  }, [productosLocales, ventaProductoBusqueda]);

  useEffect(() => {
    if (!params.ventasPage || isVendedorVentasPage(params.ventasPage)) return;
    navigate("/vendedor/ventas/pedidos", { replace: true });
  }, [navigate, params.ventasPage]);

  useEffect(() => {
    const requestedOrderId = Number(searchParams.get("pedido") ?? 0);
    if (!Number.isInteger(requestedOrderId) || requestedOrderId <= 0) return;
    setFiltroEstadoOrden("");
    setBusquedaOrdenes("");
    setOrdenExpandidaId(requestedOrderId);
  }, [searchParams]);

  useEffect(() => {
    if (ventaSucursalId) return;
    if (sucursales[0]) {
      setVentaSucursalId(String(sucursales[0].id));
    }
  }, [sucursales, ventaSucursalId]);

  useEffect(() => {
    if (!cajaActual) return;
    setCajaMontoApertura(emptyZeroInputValue(cajaActual.monto_apertura));
    setCajaMontoCierre(emptyZeroInputValue(cajaActual.summary.efectivoSistema ?? cajaActual.monto_apertura));
  }, [cajaActual?.id]);

  function getMaxSaborVenta(saborId: number): number {
    const actual = Number(ventaSabores[String(saborId)] ?? 0) || 0;
    return Math.max(0, totalAlfajoresVenta - (totalSaboresVenta - actual));
  }

  function upsertVentaItemDraft(nextItem: VentaLocalItemDraft) {
    setVentaItems((prev) => {
      const nextSabores = normalizeVentaDraftSabores(nextItem.sabores);
      const existingIndex = prev.findIndex((item) => (
        Number(item.producto_id) === Number(nextItem.producto_id)
        && sameVentaDraftSabores(item.sabores, nextSabores)
      ));
      if (existingIndex < 0) {
        return [
          ...prev,
          {
            ...nextItem,
            sabores: nextSabores,
          },
        ];
      }
      return prev.map((item, index) => index === existingIndex
        ? {
            ...item,
            cantidad: item.cantidad + nextItem.cantidad,
            sabores: nextSabores,
          }
        : item);
    });
  }

  function getVentaProductoCantidad(productId: number): number {
    return ventaItems
      .filter((item) => Number(item.producto_id) === Number(productId) && !item.sabores?.length)
      .reduce((acc, item) => acc + item.cantidad, 0);
  }

  function prepararProductoVentaConSabores(producto: Producto) {
    setOrdenErr("");
    setOrdenMsg("");
    setVentaProductoId(String(producto.id));
    setVentaCantidad("1");
    setVentaSabores({});
  }

  function cambiarCantidadProductoVenta(producto: Producto, delta: number) {
    setOrdenErr("");
    setOrdenMsg("");
    if (producto.configuracion_tipo === "caja_sabores") {
      prepararProductoVentaConSabores(producto);
      return;
    }
    if (delta < 0) {
      setVentaItems((prev) => {
        let pending = Math.abs(delta);
        return prev.flatMap((item) => {
          if (pending <= 0 || Number(item.producto_id) !== Number(producto.id) || item.sabores?.length) return [item];
          const remove = Math.min(item.cantidad, pending);
          pending -= remove;
          const nextCantidad = item.cantidad - remove;
          return nextCantidad > 0 ? [{ ...item, cantidad: nextCantidad }] : [];
        });
      });
      return;
    }
    upsertVentaItemDraft({
      producto_id: Number(producto.id),
      nombre: producto.nombre,
      cantidad: delta,
      precio_dinero: Number(producto.precio_dinero ?? 0),
      sabores: [],
    });
    setVentaProductoId("");
    setVentaCantidad("1");
    setVentaSabores({});
  }

  function cambiarCantidadVentaItem(index: number, delta: number) {
    setVentaItems((prev) => prev.flatMap((item, itemIndex) => {
      if (itemIndex !== index) return [item];
      if (item.sabores?.length) return [item];
      const nextCantidad = item.cantidad + delta;
      if (nextCantidad <= 0) return [];
      return [{ ...item, cantidad: nextCantidad }];
    }));
  }

  function updateSaborVenta(saborId: number, rawValue: string) {
    const max = getMaxSaborVenta(saborId);
    if (rawValue === "") {
      setVentaSabores((prev) => ({
        ...prev,
        [String(saborId)]: "",
      }));
      return;
    }

    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) return;

    const value = Math.floor(numericValue);
    setVentaSabores((prev) => ({
      ...prev,
      [String(saborId)]: String(Math.min(max, Math.max(0, value))),
    }));
  }

  const ordenesFiltradas = useMemo(() => {
    const q = busquedaOrdenes.trim().toLowerCase();
    return ordenes.filter((orden) => {
      if (filtroEstadoOrden && orden.estado !== filtroEstadoOrden) return false;
      if (!q) return true;
      return [
        String(orden.id),
        orden.cliente_nombre,
        orden.cliente_email,
        orden.canal,
        orden.estado,
        pagoLabel(orden.pago),
        orden.sucursal?.nombre ?? "",
        orden.direccion_envio?.localidad ?? "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [busquedaOrdenes, filtroEstadoOrden, ordenes]);

  const ordenesTotalPages = Math.max(1, Math.ceil(ordenesFiltradas.length / ORDENES_POR_PAGINA));
  const ordenesPagina = useMemo(() => {
    const safePage = Math.min(Math.max(1, ordenesPage), ordenesTotalPages);
    const start = (safePage - 1) * ORDENES_POR_PAGINA;
    return ordenesFiltradas.slice(start, start + ORDENES_POR_PAGINA);
  }, [ordenesFiltradas, ordenesPage, ordenesTotalPages]);

  useEffect(() => {
    setOrdenesPage(1);
  }, [busquedaOrdenes, filtroEstadoOrden]);

  useEffect(() => {
    setOrdenesPage((prev) => Math.min(prev, ordenesTotalPages));
  }, [ordenesTotalPages]);

  useEffect(() => {
    if (!ordenExpandidaId) return;
    const expandedIndex = ordenesFiltradas.findIndex((orden) => orden.id === ordenExpandidaId);
    if (expandedIndex < 0) return;
    const targetPage = Math.floor(expandedIndex / ORDENES_POR_PAGINA) + 1;
    setOrdenesPage((prev) => (prev === targetPage ? prev : targetPage));
  }, [ordenExpandidaId, ordenesFiltradas]);

  const actualizarOrdenMutation = useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: "pagada" | "preparandose" | "preparada" | "enviada" | "entregando" | "entregada" }) =>
      api.patch<{ ok: true }>(`/vendedor/ordenes/${id}`, { estado }),
    onSuccess: async (_data, variables) => {
      setOrdenErr("");
      setOrdenMsg(`Pedido #${variables.id} actualizado a ${estadoOrdenLabel(variables.estado)}.`);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo actualizar el pedido.");
    },
  });

  const cancelarOrdenMutation = useMutation({
    mutationFn: ({ id, motivo, mensaje_devolucion }: { id: number; motivo: string; mensaje_devolucion?: string }) =>
      api.post<{ ok: true; requiere_devolucion?: boolean; conversacion_id?: number | null }>(`/vendedor/ordenes/${id}/cancelar`, {
        motivo,
        mensaje_devolucion,
      }),
    onSuccess: async (data, variables) => {
      setOrdenErr("");
      setOrdenMsg(
        data.requiere_devolucion
          ? `Pedido #${variables.id} cancelado. Se aviso al cliente y queda pendiente coordinar devolucion.`
          : `Pedido #${variables.id} cancelado y cliente notificado.`,
      );
      setCancelacionOrden(null);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "productos-locales"] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "caja-actual"] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo cancelar el pedido.");
    },
  });

  function resetVentaLocalDraft() {
    setVentaEditId(null);
    setVentaItems([]);
    setVentaNotas("");
    setVentaCliente(null);
    setVentaClienteQuery("");
    setVentaClienteManualNombre("");
    setVentaClienteManualDni("");
    setVentaClienteManualTelefono("");
    setVentaMetodoPago("cash");
    setVentaProductoId("");
    setVentaCantidad("1");
    setVentaSabores({});
    setVentaProductoBusqueda("");
  }

  function buildVentaLocalPayload() {
    if (!ventaSucursalId) throw new Error("Selecciona una sucursal.");
    if (!ventaItems.length) throw new Error("Agrega al menos un producto.");
    const hasManualCustomer = Boolean(
      ventaClienteManualNombre.trim() ||
      ventaClienteManualDni.trim() ||
      ventaClienteManualTelefono.trim(),
    );
    if (!ventaCliente && hasManualCustomer) {
      if (!ventaClienteManualNombre.trim()) {
        throw new Error("Para cliente manual completa al menos el nombre, o deja los campos vacios para usar Cliente generico.");
      }
      if (ventaClienteManualDni.trim() && !validateManualDni(ventaClienteManualDni)) {
        throw new Error("El DNI del cliente manual debe tener solo numeros y entre 6 y 10 digitos.");
      }
      if (!validateManualPhone(ventaClienteManualTelefono)) {
        throw new Error("El telefono manual solo puede contener numeros y debe tener entre 6 y 15 digitos.");
      }
    }

    return {
      usuario_id: ventaCliente?.id,
      cliente_local: ventaCliente || !hasManualCustomer
        ? undefined
        : {
            nombre: ventaClienteManualNombre.trim(),
            dni: ventaClienteManualDni.trim() || undefined,
            telefono: ventaClienteManualTelefono.trim() || undefined,
          },
      sucursal_id: Number(ventaSucursalId),
      metodo_pago: ventaMetodoPago,
      acreditar_puntos: Boolean(ventaCliente?.id),
      notas: ventaNotas.trim() || undefined,
      items: ventaItems.map((item) => ({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        sabores: item.sabores?.map((sabor) => ({
          sabor_id: sabor.sabor_id,
          cantidad: sabor.cantidad,
        })),
      })),
    };
  }

  const registrarVentaLocalMutation = useMutation({
    mutationFn: () =>
      ventaEditId
        ? api.put<{ ok: true; ordenId: number }>(`/vendedor/ventas-locales/${ventaEditId}`, buildVentaLocalPayload())
        : api.post<{ ok: true; ordenId: number }>("/vendedor/ventas-locales", buildVentaLocalPayload()),
    onSuccess: async (data) => {
      setOrdenErr("");
      const editedOrderId = ventaEditId;
      setOrdenMsg(
        editedOrderId
          ? `Venta local #${data.ordenId} actualizada correctamente.`
          : `Venta local registrada como orden #${data.ordenId}. El stock compartido de la sucursal se actualizo.`,
      );
      resetVentaLocalDraft();
      setOrdenExpandidaId(data.ordenId);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "caja-actual", ventaSucursalId] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "productos-locales"] });
      if (editedOrderId) {
        navigate("/vendedor/ventas/pedidos");
      }
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || (ventaEditId ? "No se pudo actualizar la venta local." : "No se pudo registrar la venta local."));
    },
  });

  const abrirCajaMutation = useMutation({
    mutationFn: () => {
      if (!ventaSucursalId) throw new Error("Selecciona una sucursal.");
      return api.post<CajaSesionVendedor>("/vendedor/caja/apertura", {
        sucursal_id: Number(ventaSucursalId),
        monto_apertura: Number(cajaMontoApertura || 0),
        observaciones: cajaObservacionesApertura.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setOrdenErr("");
      setOrdenMsg("Apertura de caja guardada correctamente.");
      setCajaObservacionesApertura("");
      setCajaMontoCierre(cajaMontoApertura);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "caja-actual", ventaSucursalId] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo abrir la caja.");
    },
  });

  const cerrarCajaMutation = useMutation({
    mutationFn: () => {
      if (!cajaActual?.id) throw new Error("No hay una caja abierta.");
      return api.post<CajaSesionVendedor>(`/vendedor/caja/${cajaActual.id}/cierre`, {
        monto_cierre_declarado: Number(cajaMontoCierre || 0),
        observaciones: cajaObservacionesCierre.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setOrdenErr("");
      setOrdenMsg("Caja cerrada correctamente.");
      setCajaObservacionesCierre("");
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "caja-actual", ventaSucursalId] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "gastos", ventaSucursalId] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo cerrar la caja.");
    },
  });

  const registrarGastoMutation = useMutation({
    mutationFn: () => {
      if (!ventaSucursalId) throw new Error("Selecciona una sucursal.");
      const categoria = gastoCategoria.trim();
      const descripcion = gastoDescripcion.trim() || categoria;
      const monto = Number(gastoMonto || 0);
      if (!categoria) throw new Error("Completa la categoria del gasto.");
      if (!gastoProveedorId && !gastoTerceroNombre.trim()) throw new Error("Selecciona proveedor o completa tercero.");
      if (!Number.isFinite(monto) || monto <= 0) throw new Error("Completa un monto mayor a 0.");
      return api.post<{ ok: true; id: number }>("/vendedor/gastos", {
        sucursal_id: Number(ventaSucursalId),
        proveedor_id: gastoProveedorId ? Number(gastoProveedorId) : undefined,
        tercero_nombre: gastoProveedorId ? undefined : gastoTerceroNombre.trim(),
        categoria,
        descripcion,
        medio_pago: gastoMedioPago,
        monto,
        notas: gastoNotas.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setOrdenErr("");
      setOrdenMsg("Gasto registrado correctamente.");
      setGastoProveedorId("");
      setGastoTerceroNombre("");
      setGastoCategoria("");
      setGastoDescripcion("");
      setGastoMonto("");
      setGastoMedioPago("cash");
      setGastoNotas("");
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "caja-actual", ventaSucursalId] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "gastos", ventaSucursalId] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo registrar el gasto.");
    },
  });

  const editarGastoMutation = useMutation({
    mutationFn: () => {
      if (!gastoEditId) throw new Error("Selecciona un gasto para editar.");
      const categoria = gastoEditDraft.categoria.trim();
      const descripcion = gastoEditDraft.descripcion.trim() || categoria;
      const monto = Number(gastoEditDraft.monto || 0);
      if (!categoria) throw new Error("Completa la categoria del gasto.");
      if (!gastoEditDraft.proveedor_id && !gastoEditDraft.tercero_nombre.trim()) {
        throw new Error("Selecciona proveedor o completa tercero.");
      }
      if (!Number.isFinite(monto) || monto <= 0) throw new Error("Completa un monto mayor a 0.");
      return api.put<{ ok: true }>(`/vendedor/gastos/${gastoEditId}`, {
        sucursal_id: Number(gastoEditDraft.sucursal_id || ventaSucursalId),
        proveedor_id: gastoEditDraft.proveedor_id ? Number(gastoEditDraft.proveedor_id) : undefined,
        tercero_nombre: gastoEditDraft.proveedor_id ? undefined : gastoEditDraft.tercero_nombre.trim(),
        categoria,
        descripcion,
        medio_pago: gastoEditDraft.medio_pago,
        monto,
        notas: gastoEditDraft.notas.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setOrdenErr("");
      setOrdenMsg("Gasto actualizado correctamente.");
      setGastoEditId(null);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "caja-actual", ventaSucursalId] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "gastos", ventaSucursalId] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo actualizar el gasto.");
    },
  });

  const crearProveedorMutation = useMutation({
    mutationFn: () => {
      if (!nuevoProveedor.nombre.trim()) throw new Error("El nombre del proveedor es obligatorio.");
      return api.post<{ ok: true; id: number }>("/vendedor/proveedores", {
        nombre: nuevoProveedor.nombre.trim(),
        contacto: nuevoProveedor.contacto.trim() || undefined,
        telefono: nuevoProveedor.telefono.trim() || undefined,
        email: nuevoProveedor.email.trim() || undefined,
        notas: nuevoProveedor.notas.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setOrdenErr("");
      setOrdenMsg("Proveedor creado correctamente.");
      setNuevoProveedor({ nombre: "", contacto: "", telefono: "", email: "", notas: "" });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "proveedores"] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo crear el proveedor.");
    },
  });

  const editarProveedorMutation = useMutation({
    mutationFn: () => {
      if (!proveedorEditId) throw new Error("Selecciona un proveedor para editar.");
      if (!proveedorEditDraft.nombre.trim()) throw new Error("El nombre del proveedor es obligatorio.");
      return api.put<{ ok: true }>(`/vendedor/proveedores/${proveedorEditId}`, {
        nombre: proveedorEditDraft.nombre.trim(),
        contacto: proveedorEditDraft.contacto.trim() || undefined,
        telefono: proveedorEditDraft.telefono.trim() || undefined,
        email: proveedorEditDraft.email.trim() || undefined,
        notas: proveedorEditDraft.notas.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setOrdenErr("");
      setOrdenMsg("Proveedor actualizado correctamente.");
      setProveedorEditId(null);
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "proveedores"] });
      await queryClient.invalidateQueries({ queryKey: ["vendedor", "gastos", ventaSucursalId] });
    },
    onError: (err: Error) => {
      setOrdenMsg("");
      setOrdenErr(err.message || "No se pudo actualizar el proveedor.");
    },
  });

  function empezarEditarGasto(gasto: GastoVendedor) {
    setOrdenErr("");
    setOrdenMsg("");
    setGastoEditId(gasto.id);
    setGastoEditDraft({
      sucursal_id: String(gasto.sucursal_id || ventaSucursalId),
      proveedor_id: gasto.proveedor_id ? String(gasto.proveedor_id) : "",
      tercero_nombre: gasto.tercero_nombre ?? "",
      categoria: gasto.categoria ?? "",
      descripcion: gasto.descripcion ?? "",
      medio_pago: gasto.medio_pago || "cash",
      monto: emptyZeroInputValue(gasto.monto),
      notas: gasto.notas ?? "",
    });
  }

  function empezarEditarProveedor(proveedor: ProveedorVendedor) {
    setOrdenErr("");
    setOrdenMsg("");
    setProveedorEditId(proveedor.id);
    setProveedorEditDraft({
      nombre: proveedor.nombre ?? "",
      contacto: proveedor.contacto ?? "",
      telefono: proveedor.telefono ?? "",
      email: proveedor.email ?? "",
      notas: proveedor.notas ?? "",
    });
  }

  function puedeEditarVentaLocal(orden: OrdenVendedor): boolean {
    return orden.canal === "vendedor" && orden.tipo_orden === "venta" && orden.estado !== "cancelada" && orden.estado !== "expirada";
  }

  function empezarEditarVentaLocal(orden: OrdenVendedor) {
    setOrdenErr("");
    setOrdenMsg("");
    setVentaEditId(orden.id);
    setVentaProductoId("");
    setVentaCantidad("1");
    setVentaSabores({});
    setVentaProductoBusqueda("");
    setVentaSucursalId(String(orden.sucursal?.id ?? selectedSucursalValue));
    setVentaMetodoPago(orden.pago?.metodo ?? "cash");
    setVentaNotas(extractEditableSaleNotes(orden.notas));
    setVentaItems(
      (orden.items ?? []).map((item) => ({
        producto_id: item.producto_id,
        nombre: item.nombre,
        cantidad: item.cantidad,
        precio_dinero: item.cantidad > 0 ? Number(item.subtotal_dinero ?? 0) / item.cantidad : 0,
        sabores: item.sabores?.map((sabor) => ({
          sabor_id: sabor.sabor_id,
          nombre: sabor.nombre,
          cantidad: sabor.cantidad,
        })),
      })),
    );

    if (orden.usuario_id) {
      setVentaCliente({
        id: Number(orden.usuario_id),
        nombre: orden.cliente_nombre,
        dni: orden.cliente_dni ?? "",
        email: orden.cliente_email ?? "",
        puntos: 0,
      });
      setVentaClienteQuery("");
      setVentaClienteManualNombre("");
      setVentaClienteManualDni("");
      setVentaClienteManualTelefono("");
    } else {
      setVentaCliente(null);
      setVentaClienteQuery("");
      if (isGenericLocalOrderCustomer(orden)) {
        setVentaClienteManualNombre("");
        setVentaClienteManualDni("");
        setVentaClienteManualTelefono("");
      } else {
        setVentaClienteManualNombre(orden.cliente_nombre ?? "");
        setVentaClienteManualDni(orden.cliente_dni ?? "");
        setVentaClienteManualTelefono(orden.cliente_telefono ?? "");
      }
    }

    navigate("/vendedor/ventas/local");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function puedeMarcarPagada(orden: OrdenVendedor): boolean {
    return orden.estado === "pendiente_pago" && (orden.pago?.proveedor === "efectivo" || orden.pago?.metodo === "cash");
  }

  function puedeCancelarOrden(orden: OrdenVendedor): boolean {
    return ["pendiente_pago", "pagada", "preparandose", "preparada", "enviada", "entregando"].includes(orden.estado);
  }

  function actualizarOrden(id: number, estado: "pagada" | "preparandose" | "preparada" | "enviada" | "entregando" | "entregada") {
    setOrdenErr("");
    setOrdenMsg("");
    actualizarOrdenMutation.mutate({ id, estado });
  }

  function abrirCancelacionUrgente(orden: OrdenVendedor) {
    setOrdenErr("");
    setOrdenMsg("");
    setCancelacionOrden({
      orden,
      motivo: "",
      mensaje_devolucion: "Si ya abonaste el pedido, por este mismo chat coordinamos la devolucion del dinero como ultima instancia.",
    });
  }

  function confirmarCancelacionUrgente() {
    if (!cancelacionOrden) return;
    const motivo = cancelacionOrden.motivo.trim();
    if (motivo.length < 8) {
      setOrdenErr("Escribe un motivo claro para informar al cliente.");
      return;
    }
    cancelarOrdenMutation.mutate({
      id: cancelacionOrden.orden.id,
      motivo,
      mensaje_devolucion: cancelacionOrden.mensaje_devolucion.trim() || undefined,
    });
  }

  function agregarItemVentaLocal() {
    setOrdenErr("");
    setOrdenMsg("");
    const producto = productoVentaSeleccionado;
    if (!producto) {
      setOrdenErr("Selecciona un producto.");
      return;
    }
    const cantidad = Number(ventaCantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setOrdenErr("La cantidad debe ser un entero mayor a 0.");
      return;
    }

    const saboresItem = producto.configuracion_tipo === "caja_sabores"
      ? saboresProductoVenta
          .map((sabor) => ({
            sabor_id: sabor.id,
            nombre: sabor.nombre,
            cantidad: Number(ventaSabores[String(sabor.id)] ?? 0) || 0,
          }))
          .filter((sabor) => sabor.cantidad > 0)
      : [];
    if (producto.configuracion_tipo === "caja_sabores") {
      const capacidad = Number(producto.capacidad_sabores ?? 0);
      const totalRequerido = capacidad * cantidad;
      if (totalSaboresVenta !== totalRequerido) {
        setOrdenErr(`Selecciona exactamente ${totalRequerido} alfajores para ${cantidad} caja${cantidad === 1 ? "" : "s"} de ${producto.nombre}.`);
        return;
      }
    }

    upsertVentaItemDraft({
      producto_id: producto.id,
      nombre: producto.nombre,
      cantidad,
      precio_dinero: Number(producto.precio_dinero ?? 0),
      sabores: saboresItem,
    });
    setVentaProductoId("");
    setVentaCantidad("1");
    setVentaSabores({});
  }

  return (
    <section className="dashboard-section vendedor-dashboard-section vendedor-ventas-shell">
      <div
        className={`ios-card p-4 vendedor-ventas-hero${currentPage === "local" ? " vendedor-ventas-hero-full" : ""}`}
        style={currentPage === "local" ? undefined : { borderLeft: "4px solid #D4621A" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h1 className="ios-title" style={{ marginBottom: "0.25rem" }}>Ventas y Pedidos</h1>
            <p className="text-sm" style={{ color: "#6b7280" }}>
              Gestiona pedidos pagados, preparacion, envio y entrega.
            </p>
          </div>
          <button
            type="button"
            className="ios-btn-secondary"
            style={{ width: "auto", padding: "0.65rem 1rem" }}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["vendedor", "ordenes"] })}
          >
            Actualizar
          </button>
        </div>

        <div className="vendedor-ventas-nav">
          <button
            type="button"
            className={`vendedor-ventas-nav-btn${currentPage === "pedidos" ? " active" : ""}`}
            onClick={() => navigate("/vendedor/ventas/pedidos")}
          >
            Pedidos
          </button>
          <button
            type="button"
            className={`vendedor-ventas-nav-btn${currentPage === "local" ? " active" : ""}`}
            onClick={() => navigate("/vendedor/ventas/local")}
          >
            Venta local
          </button>
          <button
            type="button"
            className={`vendedor-ventas-nav-btn${currentPage === "caja" ? " active" : ""}`}
            onClick={() => navigate("/vendedor/ventas/caja")}
          >
            Caja diaria
          </button>
          <button
            type="button"
            className={`vendedor-ventas-nav-btn${currentPage === "gastos" ? " active" : ""}`}
            onClick={() => navigate("/vendedor/ventas/gastos")}
          >
            Gastos
          </button>
          <button
            type="button"
            className={`vendedor-ventas-nav-btn${currentPage === "proveedores" ? " active" : ""}`}
            onClick={() => navigate("/vendedor/ventas/proveedores")}
          >
            Proveedores
          </button>
        </div>

        {ordenErr ? <div className="status-err-box mt-3"><p>{ordenErr}</p></div> : null}
        {ordenMsg ? <div className="status-ok-box mt-3"><p>{ordenMsg}</p></div> : null}

        {currentPage === "caja" ? (
        <div className="ios-card p-4 vendedor-ventas-panel" style={{ marginTop: "1rem", background: "#FFF8F1", border: "1px solid #F5C8A8" }}>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h2 className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>Caja del dia</h2>
              <p className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                La caja se genera automaticamente por local y por fecha Buenos Aires. Las ventas locales y los gastos se registran sobre esa caja del dia.
              </p>
            </div>
            <div className="ios-card p-3" style={{ background: "#FFFDF8", border: "1px solid #F5C8A8", display: "grid", gap: "0.35rem" }}>
              <strong style={{ color: "#3D1A02" }}>Flujo exacto de caja</strong>
              <p className="text-xs" style={{ color: "#A08060", margin: 0 }}>
                El sistema crea automaticamente una sola caja diaria por cada local, desde las 00:00 hasta las 23:59 en horario Buenos Aires.
              </p>
              <p className="text-xs" style={{ color: "#A08060", margin: 0 }}>
                Todas las ventas y gastos que cargue cualquier vendedor en ese local entran en la misma caja del dia.
              </p>
              <p className="text-xs" style={{ color: "#A08060", margin: 0 }}>
                Las ventas locales suman como ingresos de caja y los gastos cargados restan como egresos. Ambos quedan separados por medio de pago: efectivo, transferencia, tarjeta, QR u otro.
              </p>
              <p className="text-xs" style={{ color: "#A08060", margin: 0 }}>
                El efectivo del dia se calcula solo con efectivo: apertura + ventas en efectivo - gastos en efectivo. Los otros medios quedan visibles aparte para control y reportes.
              </p>
              <p className="text-xs" style={{ color: "#A08060", margin: 0 }}>
                Al terminar el dia, la caja anterior se cierra automaticamente y al dia siguiente se empieza una nueva.
              </p>
            </div>
            <div className="adm-form-grid">
              <select className="ios-input" value={selectedSucursalValue} onChange={(event) => setVentaSucursalId(event.target.value)} disabled={!sucursales.length}>
                {sucursales.length ? (
                  sucursales.map((sucursal) => (
                    <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>
                  ))
                ) : (
                  <option value="">Sin locales activos</option>
                )}
              </select>
            </div>
            <div className="ios-card p-3" style={{ background: "#FFFDF8", border: "1px solid #F5C8A8", display: "grid", gap: "0.65rem" }}>
              <div>
                <strong style={{ color: "#3D1A02" }}>Apertura / efectivo inicial</strong>
                <p className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                  Es la plata en efectivo con la que arranca el dia. Si no habia efectivo, dejalo vacio. Se usa para calcular efectivo: apertura + ventas en efectivo - gastos en efectivo.
                </p>
              </div>
              <div className="adm-form-grid">
                <input
                  className="ios-input"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Monto inicial"
                  value={cajaMontoApertura}
                  onChange={(event) => setCajaMontoApertura(event.target.value)}
                />
                <input
                  className="ios-input"
                  placeholder="Nota de apertura opcional"
                  value={cajaObservacionesApertura}
                  onChange={(event) => setCajaObservacionesApertura(event.target.value)}
                />
                <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} disabled={abrirCajaMutation.isPending || !ventaSucursalId} onClick={() => abrirCajaMutation.mutate()}>
                  {abrirCajaMutation.isPending ? "Guardando..." : "Guardar apertura"}
                </button>
              </div>
            </div>
            {cajaActual ? (
              <>
                <div className="adm-form-grid">
                  <div className="ios-row"><strong>Fecha:</strong> {cajaActual.fecha_operativa}</div>
                  <div className="ios-row"><strong>Apertura:</strong> {money(cajaActual.monto_apertura)}</div>
                  <div className="ios-row"><strong>Ventas:</strong> {money(cajaActual.summary.totalVentas)}</div>
                  <div className="ios-row"><strong>Gastos:</strong> {money(cajaActual.summary.totalGastos)}</div>
                  <div className="ios-row"><strong>Efectivo del dia:</strong> {money(cajaActual.summary.efectivoSistema)}</div>
                </div>
                <p className="text-xs" style={{ color: "#A08060", margin: 0 }}>
                  El cierre diario se toma automaticamente al terminar el dia en horario Buenos Aires.
                </p>
                <div className="adm-form-grid">
                  <div className="ios-card p-3">
                    <strong>Ventas por medio</strong>
                    {Object.entries(cajaActual.summary.ventasPorMedio ?? {}).map(([medio, monto]) => (
                      <p key={`venta-${medio}`} className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                        {metodoPagoLabel(medio)}: {money(monto)}
                      </p>
                    ))}
                  </div>
                  <div className="ios-card p-3">
                    <strong>Gastos por medio</strong>
                    {Object.entries(cajaActual.summary.gastosPorMedio ?? {}).map(([medio, monto]) => (
                      <p key={`gasto-${medio}`} className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                        {metodoPagoLabel(medio)}: {money(monto)}
                      </p>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
        ) : null}

        {currentPage === "gastos" ? (
        <div className="ios-card p-4 vendedor-ventas-panel" style={{ marginTop: "1rem", background: "#FFF8F1", border: "1px solid #F5C8A8" }}>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h2 className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>Gastos de caja</h2>
              <p className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                Registra pagos a proveedores o terceros para que el cierre de caja reste esos montos correctamente.
              </p>
            </div>
            <div className="adm-form-grid">
              <select className="ios-input" value={gastoProveedorId} onChange={(event) => setGastoProveedorId(event.target.value)}>
                <option value="">Proveedor</option>
                {proveedores.map((proveedor) => (
                  <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>
                ))}
              </select>
              <input className="ios-input" placeholder="Tercero (si no es proveedor)" value={gastoTerceroNombre} disabled={Boolean(gastoProveedorId)} onChange={(event) => setGastoTerceroNombre(event.target.value)} />
              <input className="ios-input" placeholder="Categoria" value={gastoCategoria} onChange={(event) => setGastoCategoria(event.target.value)} />
              <input className="ios-input" placeholder="Descripcion opcional" value={gastoDescripcion} onChange={(event) => setGastoDescripcion(event.target.value)} />
              <select className="ios-input" value={gastoMedioPago} onChange={(event) => setGastoMedioPago(event.target.value)}>
                <option value="cash">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="qr">QR</option>
                <option value="otro">Otro</option>
              </select>
              <input className="ios-input" type="number" min={0} step="0.01" placeholder="Monto" value={gastoMonto} onChange={(event) => setGastoMonto(event.target.value)} />
              <input className="ios-input" placeholder="Notas" value={gastoNotas} onChange={(event) => setGastoNotas(event.target.value)} />
              <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} disabled={registrarGastoMutation.isPending || !cajaActual} onClick={() => registrarGastoMutation.mutate()}>
                {registrarGastoMutation.isPending ? "Guardando..." : "Registrar gasto"}
              </button>
            </div>
            {gastos.length ? (
              <div style={{ display: "grid", gap: "0.45rem" }}>
                {gastos.slice(0, 8).map((gasto) => {
                  const editing = gastoEditId === gasto.id;
                  return (
                    <div key={gasto.id} className="ios-row" style={{ display: "grid", gap: "0.65rem" }}>
                      {editing ? (
                        <>
                          <div className="adm-form-grid">
                            <select
                              className="ios-input"
                              value={gastoEditDraft.proveedor_id}
                              onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, proveedor_id: event.target.value, tercero_nombre: event.target.value ? "" : prev.tercero_nombre }))}
                            >
                              <option value="">Proveedor</option>
                              {proveedores.map((proveedor) => (
                                <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>
                              ))}
                            </select>
                            <input
                              className="ios-input"
                              placeholder="Tercero (si no es proveedor)"
                              value={gastoEditDraft.tercero_nombre}
                              disabled={Boolean(gastoEditDraft.proveedor_id)}
                              onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, tercero_nombre: event.target.value }))}
                            />
                            <input className="ios-input" placeholder="Categoria" value={gastoEditDraft.categoria} onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, categoria: event.target.value }))} />
                            <input className="ios-input" placeholder="Descripcion" value={gastoEditDraft.descripcion} onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, descripcion: event.target.value }))} />
                            <select className="ios-input" value={gastoEditDraft.medio_pago} onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, medio_pago: event.target.value }))}>
                              <option value="cash">Efectivo</option>
                              <option value="transferencia">Transferencia</option>
                              <option value="tarjeta">Tarjeta</option>
                              <option value="qr">QR</option>
                              <option value="otro">Otro</option>
                            </select>
                            <input className="ios-input" type="number" min={0} step="0.01" placeholder="Monto" value={gastoEditDraft.monto} onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, monto: event.target.value }))} />
                            <input className="ios-input" placeholder="Notas" value={gastoEditDraft.notas} onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, notas: event.target.value }))} />
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            <button type="button" className="ios-btn-primary" style={{ width: "auto" }} disabled={editarGastoMutation.isPending} onClick={() => editarGastoMutation.mutate()}>
                              {editarGastoMutation.isPending ? "Guardando..." : "Guardar"}
                            </button>
                            <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} disabled={editarGastoMutation.isPending} onClick={() => setGastoEditId(null)}>
                              Cancelar
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>{gasto.descripcion}</strong>
                            <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>
                              {gasto.categoria} / {money(gasto.monto)} / {metodoPagoLabel(gasto.medio_pago)} / {gasto.proveedor_nombre || gasto.tercero_nombre || "Sin nombre"}
                            </p>
                            {gasto.notas ? (
                              <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>{gasto.notas}</p>
                            ) : null}
                          </div>
                          <button type="button" className="ios-btn-secondary" style={{ width: "fit-content", padding: "0.45rem 0.8rem" }} onClick={() => empezarEditarGasto(gasto)}>
                            Editar
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        ) : null}

        {currentPage === "proveedores" ? (
        <div className="ios-card p-4 vendedor-ventas-panel" style={{ marginTop: "1rem", background: "#FFF8F1", border: "1px solid #F5C8A8" }}>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h2 className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>Proveedores</h2>
              <p className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                Carga proveedores para registrar luego los gastos de caja sin depender del panel admin.
              </p>
            </div>
            <div className="adm-form-grid">
              <input className="ios-input" placeholder="Nombre proveedor" value={nuevoProveedor.nombre} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, nombre: event.target.value }))} />
              <input className="ios-input" placeholder="Contacto" value={nuevoProveedor.contacto} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, contacto: event.target.value }))} />
              <input className="ios-input" placeholder="Telefono" value={nuevoProveedor.telefono} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, telefono: event.target.value }))} />
              <input className="ios-input" placeholder="Email" value={nuevoProveedor.email} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, email: event.target.value }))} />
              <input className="ios-input" placeholder="Notas" value={nuevoProveedor.notas} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, notas: event.target.value }))} />
              <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} disabled={crearProveedorMutation.isPending} onClick={() => crearProveedorMutation.mutate()}>
                {crearProveedorMutation.isPending ? "Guardando..." : "Crear proveedor"}
              </button>
            </div>
            <div style={{ display: "grid", gap: "0.45rem" }}>
              {proveedores.length === 0 ? (
                <div className="ios-row text-ios-secondary text-sm">Todavia no hay proveedores cargados.</div>
              ) : (
                proveedores.map((proveedor) => {
                  const editing = proveedorEditId === proveedor.id;
                  return (
                    <div key={proveedor.id} className="ios-row" style={{ display: "grid", gap: "0.65rem" }}>
                      {editing ? (
                        <>
                          <div className="adm-form-grid">
                            <input className="ios-input" placeholder="Nombre proveedor" value={proveedorEditDraft.nombre} onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, nombre: event.target.value }))} />
                            <input className="ios-input" placeholder="Contacto" value={proveedorEditDraft.contacto} onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, contacto: event.target.value }))} />
                            <input className="ios-input" placeholder="Telefono" value={proveedorEditDraft.telefono} onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, telefono: event.target.value }))} />
                            <input className="ios-input" placeholder="Email" value={proveedorEditDraft.email} onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, email: event.target.value }))} />
                            <input className="ios-input" placeholder="Notas" value={proveedorEditDraft.notas} onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, notas: event.target.value }))} />
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            <button type="button" className="ios-btn-primary" style={{ width: "auto" }} disabled={editarProveedorMutation.isPending} onClick={() => editarProveedorMutation.mutate()}>
                              {editarProveedorMutation.isPending ? "Guardando..." : "Guardar"}
                            </button>
                            <button type="button" className="ios-btn-secondary" style={{ width: "auto" }} disabled={editarProveedorMutation.isPending} onClick={() => setProveedorEditId(null)}>
                              Cancelar
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>{proveedor.nombre}</strong>
                            <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>
                              {[proveedor.contacto, proveedor.telefono, proveedor.email].filter(Boolean).join(" / ") || "Sin datos extra"}
                            </p>
                            {proveedor.notas ? (
                              <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>{proveedor.notas}</p>
                            ) : null}
                          </div>
                          <button type="button" className="ios-btn-secondary" style={{ width: "fit-content", padding: "0.45rem 0.8rem" }} onClick={() => empezarEditarProveedor(proveedor)}>
                            Editar
                          </button>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        ) : null}

        {currentPage === "local" ? (
        <div className="vendedor-ventas-panel local-sale-register-shell" style={{ marginTop: "1rem" }}>
          <div className="local-sale-header">
            <div>
              <h2 className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>{ventaEnEdicion ? `Editar venta local #${ventaEditId}` : "Registrar venta local"}</h2>
              <p className="text-xs" style={{ color: "#A08060", margin: "0.2rem 0 0" }}>
                Venta presencial rapida: descuenta stock, suma en caja y solo acredita puntos si eliges un cliente web registrado.
              </p>
            </div>
          </div>
            {ventaEnEdicion ? (
              <div className="rounded-xl p-3" style={{ background: "#FEF3E8", border: "1px solid #F5C8A8", display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                <p className="text-sm" style={{ margin: 0, color: "#7C2D12", fontWeight: 700 }}>
                  Estas editando una venta ya guardada. La sucursal queda fija para no mover caja ni stock historico.
                </p>
                <button
                  type="button"
                  className="ios-btn-secondary"
                  style={{ width: "auto", padding: "0.55rem 0.85rem" }}
                  onClick={resetVentaLocalDraft}
                >
                  Cancelar edicion
                </button>
              </div>
            ) : null}

          <div className="local-sale-pos-layout">
            <section className="local-sale-catalog-panel" aria-label="Catalogo de productos para venta local">
              <div className="local-sale-product-search">
                <input
                  className="ios-input local-sale-search-input"
                  placeholder="Buscar productos"
                  value={ventaProductoBusqueda}
                  onChange={(event) => setVentaProductoBusqueda(event.target.value)}
                />
                <span className="local-sale-count-pill">
                  {productosVentaFiltrados.length} de {productosLocales.length} productos
                </span>
              </div>
              <div className="local-sale-products-grid">
                {productosLocalesQuery.isLoading ? (
                  <div className="local-sale-empty">Cargando productos...</div>
                ) : null}
                {!productosLocalesQuery.isLoading && productosVentaFiltrados.length === 0 ? (
                  <div className="local-sale-empty">No hay productos que coincidan con la busqueda.</div>
                ) : null}
                {productosVentaFiltrados.map((producto) => {
                    const image = getLocalSaleQuickProductImage(producto);
                    const productQuantity = getVentaProductoCantidad(Number(producto.id));
                    const isFlavorBox = producto.configuracion_tipo === "caja_sabores";
                    const isSelected = ventaProductoId === String(producto.id);
                    return (
                      <article key={`local-product-${producto.id}`} className={`local-sale-product-card${isSelected ? " is-active" : ""}`}>
                        <div className={`local-sale-product-media${image ? "" : " is-empty"}`}>
                          {image ? (
                            <img
                              src={image}
                              alt={producto.nombre}
                              className="local-sale-product-image"
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                                event.currentTarget.parentElement?.classList.add("has-image-error");
                              }}
                            />
                          ) : null}
                          <div className="local-sale-product-placeholder">
                            {image ? "Foto no disponible" : "Sin foto"}
                          </div>
                        </div>
                        <div className="local-sale-product-info">
                          <p className="local-sale-product-title">{producto.nombre}</p>
                          <p className="local-sale-product-subtitle">{getLocalSaleQuickProductSubtitle(producto)}</p>
                          <strong className="local-sale-product-price">{money(producto.precio_dinero)}</strong>
                        </div>
                        {isFlavorBox ? (
                          <button
                            type="button"
                            className="local-sale-product-choose-btn"
                            onClick={() => prepararProductoVentaConSabores(producto)}
                          >
                            Elegir sabores
                          </button>
                        ) : (
                          <div className="local-sale-product-stepper" role="group" aria-label={`Cantidad de ${producto.nombre}`}>
                            <button type="button" className="local-sale-product-step-btn" onClick={() => cambiarCantidadProductoVenta(producto, -1)} aria-label={`Quitar ${producto.nombre}`}>
                              -
                            </button>
                            <span className="local-sale-product-qty">{productQuantity}</span>
                            <button type="button" className="local-sale-product-step-btn" onClick={() => cambiarCantidadProductoVenta(producto, 1)} aria-label={`Agregar ${producto.nombre}`}>
                              +
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
            </section>

            <aside className="local-sale-checkout-panel" aria-label="Finalizar venta local">
              <div className="local-sale-checkout-title">
                <span className="local-sale-checkout-badge">Venta</span>
                <h3>Finalizar venta</h3>
              </div>

              <div className="local-sale-checkout-fields">
                <label className="local-sale-field">
                  <span>Cliente web registrado</span>
                  <div className="local-sale-client-search">
                    <input
                      className="ios-input"
                      placeholder="Buscar cliente por nombre o DNI"
                      value={ventaCliente ? `${ventaCliente.nombre} - ${ventaCliente.dni}` : ventaClienteQuery}
                      onChange={(event) => {
                        setVentaCliente(null);
                        setVentaClienteQuery(event.target.value);
                      }}
                    />
                    {!ventaCliente && clientesEncontrados.length ? (
                      <div className="local-sale-client-results">
                        {clientesEncontrados.map((cliente) => (
                          <button
                            key={cliente.id}
                            type="button"
                            className="local-sale-client-option"
                            onClick={() => {
                              setVentaCliente(cliente);
                              setVentaClienteQuery("");
                            }}
                          >
                            {cliente.nombre} - DNI {cliente.dni}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </label>
                {ventaCliente ? (
                  <button
                    type="button"
                    className="local-sale-inline-btn"
                    onClick={() => {
                      setVentaCliente(null);
                      setVentaClienteQuery("");
                    }}
                  >
                    Quitar cliente web
                  </button>
                ) : null}
                <label className="local-sale-field">
                  <span>Nombre del cliente manual</span>
                  <input
                    className="ios-input"
                    placeholder="Opcional"
                    value={ventaCliente ? "" : ventaClienteManualNombre}
                    disabled={Boolean(ventaCliente)}
                    onChange={(event) => setVentaClienteManualNombre(event.target.value)}
                  />
                </label>
                <label className="local-sale-field">
                  <span>DNI manual</span>
                  <input
                    className="ios-input"
                    placeholder="Opcional"
                    inputMode="numeric"
                    maxLength={10}
                    value={ventaCliente ? "" : ventaClienteManualDni}
                    disabled={Boolean(ventaCliente)}
                    onChange={(event) => setVentaClienteManualDni(sanitizeManualDni(event.target.value))}
                  />
                </label>
                <label className="local-sale-field">
                  <span>Telefono manual</span>
                  <input
                    className="ios-input"
                    placeholder="Opcional"
                    inputMode="tel"
                    maxLength={25}
                    value={ventaCliente ? "" : ventaClienteManualTelefono}
                    disabled={Boolean(ventaCliente)}
                    onChange={(event) => setVentaClienteManualTelefono(sanitizeManualPhone(event.target.value))}
                  />
                </label>
                <label className="local-sale-field">
                  <span>Sucursal</span>
                  <select className="ios-input" value={selectedSucursalValue} onChange={(event) => setVentaSucursalId(event.target.value)} disabled={!sucursales.length || ventaEnEdicion}>
                    {sucursales.length ? (
                      sucursales.map((sucursal) => (
                        <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>
                      ))
                    ) : (
                      <option value="">Sin locales activos</option>
                    )}
                  </select>
                </label>
                <label className="local-sale-field">
                  <span>Metodo de pago</span>
                  <select className="ios-input" value={ventaMetodoPago} onChange={(event) => setVentaMetodoPago(event.target.value)}>
                    <option value="cash">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="qr">QR</option>
                    <option value="otro">Otro</option>
                  </select>
                </label>
                <label className="local-sale-field">
                  <span>Notas internas</span>
                  <input className="ios-input" placeholder="Opcional" value={ventaNotas} onChange={(event) => setVentaNotas(event.target.value)} />
                </label>
              </div>

              <p className="local-sale-help-text">
                {ventaCliente
                  ? `Cliente web: ${ventaCliente.tipo_cliente === "empleado" ? "Empleado" : ventaCliente.tipo_cliente === "mayorista" ? "Mayorista" : "Cliente"}. La compra acredita puntos automaticamente por monto.`
                  : "Puedes registrar la venta sin cliente. Si no eliges cliente web registrado, no se acreditan puntos a nadie."}
              </p>

              {productoVentaSeleccionado?.configuracion_tipo === "caja_sabores" ? (
                <div className="local-sale-flavor-panel">
                  <div className="local-sale-flavor-head">
                    <div>
                      <strong>{productoVentaSeleccionado.nombre}</strong>
                      <span>Sabores {totalSaboresVenta}/{totalAlfajoresVenta} alfajores</span>
                    </div>
                    <label>
                      Cajas
                      <input
                        className="ios-input"
                        type="number"
                        min={1}
                        value={ventaCantidad}
                        onChange={(event) => setVentaCantidad(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="local-sale-flavors-grid">
                    {saboresProductoVenta.map((sabor) => (
                      <label key={sabor.id} className="local-sale-field">
                        <span>{sabor.nombre}</span>
                        <input
                          className="ios-input"
                          type="number"
                          min={0}
                          max={getMaxSaborVenta(sabor.id)}
                          step={1}
                          inputMode="numeric"
                          value={ventaSabores[String(sabor.id)] ?? ""}
                          onChange={(event) => updateSaborVenta(sabor.id, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="local-sale-flavor-actions">
                    <button type="button" className="ios-btn-secondary" onClick={() => {
                      setVentaProductoId("");
                      setVentaCantidad("1");
                      setVentaSabores({});
                    }}>
                      Cancelar
                    </button>
                    <button type="button" className="ios-btn-primary" onClick={agregarItemVentaLocal}>
                      Agregar caja
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="local-sale-cart">
                <div className="local-sale-cart-head">
                  <strong>Productos seleccionados</strong>
                  <span>{ventaItems.length} item{ventaItems.length === 1 ? "" : "s"}</span>
                </div>
                {ventaItems.length === 0 ? (
                  <div className="local-sale-empty">Todavia no agregaste productos.</div>
                ) : null}
                {ventaItems.map((item, index) => (
                  <div key={`${item.producto_id}-${index}`} className="local-sale-cart-row">
                    <div>
                      <p>{item.nombre} x{item.cantidad}</p>
                      <strong>{money(item.precio_dinero * item.cantidad)}</strong>
                      {item.sabores?.length ? (
                        <span>{item.sabores.map((sabor) => `${sabor.nombre} x${sabor.cantidad}`).join(" | ")}</span>
                      ) : null}
                    </div>
                    <div className="local-sale-cart-actions">
                      {!item.sabores?.length ? (
                        <>
                          <button type="button" className="local-sale-mini-btn" onClick={() => cambiarCantidadVentaItem(index, -1)} aria-label={`Quitar ${item.nombre}`}>
                            -
                          </button>
                          <button type="button" className="local-sale-mini-btn" onClick={() => cambiarCantidadVentaItem(index, 1)} aria-label={`Agregar ${item.nombre}`}>
                            +
                          </button>
                        </>
                      ) : null}
                      <button type="button" className="local-sale-mini-btn danger" onClick={() => setVentaItems((prev) => prev.filter((_item, itemIndex) => itemIndex !== index))}>
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="local-sale-total-row">
                <span>Total</span>
                <strong>{money(totalVentaLocal)}</strong>
              </div>
              <button
                type="button"
                className="ios-btn-primary local-sale-confirm-btn"
                disabled={registrarVentaLocalMutation.isPending || ventaItems.length === 0}
                onClick={() => registrarVentaLocalMutation.mutate()}
              >
                {registrarVentaLocalMutation.isPending ? (ventaEnEdicion ? "Guardando..." : "Registrando...") : (ventaEnEdicion ? "Guardar cambios" : "Registrar venta local")}
              </button>
            </aside>
          </div>
        </div>
        ) : null}

        {currentPage === "pedidos" ? (
        <>
        <div className="adm-form-grid" style={{ marginTop: "1rem" }}>
          <input
            className="ios-input"
            placeholder="Buscar por cliente, orden, pago o sucursal..."
            value={busquedaOrdenes}
            onChange={(event) => setBusquedaOrdenes(event.target.value)}
          />
          <select className="ios-input" value={filtroEstadoOrden} onChange={(event) => setFiltroEstadoOrden(event.target.value)}>
            <option value="">Todos los estados</option>
            <option value="pendiente_pago">Pendiente pago</option>
            <option value="pagada">Pagada</option>
            <option value="preparandose">Preparandose</option>
            <option value="preparada">Preparada</option>
            <option value="enviada">Enviada</option>
            <option value="entregando">Entregando</option>
            <option value="entregada">Entregada</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          {ordenesQuery.isLoading ? <div className="ios-row text-ios-secondary text-sm">Cargando pedidos...</div> : null}
          {!ordenesQuery.isLoading && ordenesFiltradas.length === 0 ? (
            <div className="ios-row text-ios-secondary text-sm">No hay pedidos para mostrar.</div>
          ) : null}
          {ordenesPagina.map((orden) => (
            <div key={orden.id} className="ios-card p-4" style={{ background: "#FFF8F1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <p className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>
                    Pedido #{orden.id} - {estadoOrdenLabel(orden.estado)} - {canalLabel(orden.canal)}
                  </p>
                  <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>
                    {formatDate(orden.created_at)} - {orden.cliente_nombre} - {orden.total_unidades} unidad(es)
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p className="text-base font-bold" style={{ margin: 0 }}>{money(orden.total_dinero)}</p>
                  <p className="text-xs" style={{ color: "#A08060", margin: "0.15rem 0 0" }}>{pagoLabel(orden.pago)}</p>
                </div>
              </div>

              <div className="mt-3" style={{ display: "grid", gap: "0.25rem" }}>
                <p className="text-sm" style={{ margin: 0 }}>
                  <strong>{orden.direccion_envio ? "Envio:" : "Retiro:"}</strong>{" "}
                  {orden.direccion_envio
                    ? `${orden.direccion_envio.direccion || "-"}, ${orden.direccion_envio.localidad || "-"} (${orden.direccion_envio.codigo_postal || "s/CP"})`
                    : `${orden.sucursal?.nombre || "-"}${orden.sucursal?.direccion ? ` - ${orden.sucursal.direccion}` : ""}`}
                </p>
                {orden.direccion_envio?.telefono ? (
                  <p className="text-sm" style={{ margin: 0 }}><strong>Telefono:</strong> {orden.direccion_envio.telefono}</p>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ios-btn-secondary"
                  style={{ width: "auto", padding: "0.55rem 0.85rem" }}
                  onClick={() => setOrdenExpandidaId((prev) => prev === orden.id ? null : orden.id)}
                >
                  {ordenExpandidaId === orden.id ? "Ocultar detalle" : "Ver detalle"}
                </button>
                <Link
                  to={`/vendedor/pedidos/${orden.id}`}
                  className="ios-btn-secondary"
                  style={{ width: "auto", padding: "0.55rem 0.85rem", textDecoration: "none" }}
                >
                  Ver comprobante
                </Link>
                {puedeEditarVentaLocal(orden) ? (
                  <button
                    type="button"
                    className="ios-btn-secondary"
                    style={{ width: "auto", padding: "0.55rem 0.85rem" }}
                    onClick={() => empezarEditarVentaLocal(orden)}
                  >
                    Editar venta
                  </button>
                ) : null}
                {hasOrderMapPoint(orden.direccion_envio) ? (
                  <Link
                    to={`/vendedor/mapa-pedidos?pedido=${orden.id}`}
                    className="ios-btn-secondary"
                    style={{ width: "auto", padding: "0.55rem 0.85rem", textDecoration: "none" }}
                  >
                    Ver en mapa
                  </Link>
                ) : null}
                {puedeMarcarPagada(orden) ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "pagada")}>
                    Cobrado
                  </button>
                ) : null}
                {orden.estado === "pagada" ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "preparandose")}>
                    Preparar
                  </button>
                ) : null}
                {orden.estado === "preparandose" ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "preparada")}>
                    Pedido preparado
                  </button>
                ) : null}
                {orden.estado === "preparada" && orden.direccion_envio ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "enviada")}>
                    Enviar
                  </button>
                ) : null}
                {orden.estado === "enviada" && orden.direccion_envio ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "entregando")}>
                    Entregando
                  </button>
                ) : null}
                {(!orden.direccion_envio && ["pagada", "preparandose", "preparada"].includes(orden.estado)) || orden.estado === "entregando" ? (
                  <button type="button" className="ios-btn-primary" style={{ width: "auto", padding: "0.55rem 0.85rem", background: "#16a34a", borderColor: "#16a34a" }} disabled={actualizarOrdenMutation.isPending} onClick={() => actualizarOrden(orden.id, "entregada")}>
                    Entregar
                  </button>
                ) : null}
                {puedeCancelarOrden(orden) ? (
                  <button
                    type="button"
                    className="ios-btn-danger"
                    style={{ width: "auto", padding: "0.55rem 0.85rem" }}
                    disabled={cancelarOrdenMutation.isPending}
                    onClick={() => abrirCancelacionUrgente(orden)}
                  >
                    Cancelar
                  </button>
                ) : null}
              </div>

              {ordenExpandidaId === orden.id ? (
                <div className="mt-3 rounded-xl p-3" style={{ background: "#FEF3E8", border: "1px solid #F5C8A8" }}>
                  <p className="text-xs uppercase font-bold tracking-wider mb-2" style={{ color: "#A08060" }}>Productos</p>
                  {(orden.items ?? []).map((item) => (
                    <p key={`${orden.id}-${item.producto_id}-${item.modo_compra}`} className="text-sm" style={{ margin: "0.15rem 0" }}>
                      {item.nombre} x{item.cantidad} - {item.modo_compra === "dinero" ? money(item.subtotal_dinero) : `${item.subtotal_puntos} pts`}
                      {item.sabores?.length ? (
                        <span style={{ display: "block", color: "#A08060", fontSize: "0.8rem" }}>
                          {item.sabores.map((sabor) => `${sabor.nombre} x${sabor.cantidad}`).join(" | ")}
                        </span>
                      ) : null}
                    </p>
                  ))}
                  {orden.direccion_envio?.referencias ? (
                    <p className="text-sm mt-2" style={{ marginBottom: 0 }}><strong>Referencias:</strong> {orden.direccion_envio.referencias}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <CatalogPagination
          page={ordenesPage}
          totalPages={ordenesTotalPages}
          totalItems={ordenesFiltradas.length}
          pageSize={ORDENES_POR_PAGINA}
          itemLabel="pedidos"
          onPageChange={setOrdenesPage}
        />
        </>
        ) : null}
      </div>
      {cancelacionOrden ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(37, 20, 8, 0.45)",
            display: "grid",
            placeItems: "center",
            padding: "1rem",
          }}
        >
          <div className="ios-card p-4" style={{ width: "min(100%, 560px)", background: "#FFF8F1", display: "grid", gap: "0.8rem" }}>
            <div>
              <p className="text-base font-bold" style={{ color: "#3D1A02", margin: 0 }}>
                Cancelar #{cancelacionOrden.orden.id}
              </p>
              <p className="text-sm" style={{ color: "#8B5A30", margin: "0.25rem 0 0" }}>
                Se cancelara la orden, se devolvera el stock si corresponde y se enviara este aviso al cliente.
              </p>
            </div>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <strong>Motivo para el cliente</strong>
              <textarea
                className="ios-input"
                rows={4}
                value={cancelacionOrden.motivo}
                onChange={(event) => setCancelacionOrden((prev) => prev ? { ...prev, motivo: event.target.value } : prev)}
                placeholder="Ej: Tuvimos un problema de stock y no podemos preparar el pedido a tiempo."
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <strong>Mensaje sobre devolucion</strong>
              <textarea
                className="ios-input"
                rows={3}
                value={cancelacionOrden.mensaje_devolucion}
                onChange={(event) => setCancelacionOrden((prev) => prev ? { ...prev, mensaje_devolucion: event.target.value } : prev)}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem", marginTop: "0.25rem" }}>
              <button
                type="button"
                className="ios-btn-secondary"
                style={{ width: "100%", padding: "0.75rem 1rem", fontSize: "0.95rem" }}
                onClick={() => setCancelacionOrden(null)}
                disabled={cancelarOrdenMutation.isPending}
              >
                Volver
              </button>
              <button
                type="button"
                className="ios-btn-primary"
                style={{ width: "100%", padding: "0.75rem 1rem", fontSize: "0.95rem", background: "#9B2C2C", borderColor: "#9B2C2C" }}
                onClick={confirmarCancelacionUrgente}
                disabled={cancelarOrdenMutation.isPending || cancelacionOrden.motivo.trim().length < 8}
              >
                {cancelarOrdenMutation.isPending ? "Cancelando..." : "Cancelar y avisar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
