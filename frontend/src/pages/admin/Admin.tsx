import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState, type DragEvent } from "react";
import { api } from "../../api";
import { StaticPageGallery } from "../../components/StaticPageGallery";
import { apiUrl } from "../../lib/apiBase";
import { getCsrfToken } from "../../lib/csrf";
import { MAX_STATIC_PAGE_IMAGES, extractPageImageUrls, rebuildPageContent, renderSafeMarkdown, stripPageImages } from "../../lib/pageContent";
import type { Producto } from "../../types";

type AdminTab =
  | "inicio"
  | "usuarios"
  | "productos"
  | "categorias"
  | "transacciones"
  | "canjes"
  | "codigos"
  | "crear"
  | "sobre-nosotros"
  | "terminos";

type Stats = {
  clientes: number;
  productos: number;
  codigos_activos: number;
  canjes_pendientes: number;
  puntos_emitidos: number;
};

type SecurityEventPersisted = {
  id: number;
  creado_en: string;
  evento: string;
  ip: string;
  metodo: string;
  ruta: string;
  origen: string;
  agente_usuario: string;
  detalles: Record<string, unknown> | null;
};

type SecurityMonitorResponse = {
  counters: Record<string, number>;
  recent: Array<Record<string, unknown>>;
  persistidos: SecurityEventPersisted[];
};

type Usuario = {
  id: number;
  nombre: string;
  email: string;
  rol: "cliente" | "vendedor" | "admin";
  dni: string | null;
  telefono?: string | null;
  puntos_saldo: number;
  codigo_invitacion: string | null;
  activo: boolean;
  created_at: string;
};

type Movimiento = {
  id: number;
  tipo: string;
  puntos: number;
  descripcion: string | null;
  referencia_tipo: string | null;
  created_at: string;
  usuario_nombre: string;
  usuario_email: string;
  admin_nombre: string | null;
};

type ProductoAdmin = Producto & {
  activo: boolean;
  created_at: string;
};

type Categoria = {
  id: number;
  nombre: string;
  created_at: string;
};

type Codigo = {
  id: number;
  codigo: string;
  puntos_valor: number;
  usos_maximos: number;
  usos_actuales: number;
  fecha_expiracion: string | null;
  activo: boolean;
  created_at: string;
  creado_por_nombre: string;
};

type CanjeAdmin = {
  id: number;
  codigo_retiro?: string | null;
  puntos_usados: number;
  estado: string;
  fecha_limite_retiro: string | null;
  notas: string | null;
  created_at: string;
  cliente_nombre: string;
  cliente_email: string;
  cliente_dni: string;
  producto_nombre: string;
  productos_detalle?: string;
  total_items?: number;
  total_unidades?: number;
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

type CanjeCodigoAdmin = {
  id: number;
  codigo_retiro: string;
  puntos_usados: number;
  estado: "pendiente" | "entregado" | "no_disponible" | "expirado" | "cancelado";
  fecha_limite_retiro: string | null;
  notas: string | null;
  cliente_nombre: string;
  cliente_dni: string;
  producto_nombre: string;
  productos_detalle?: string;
  total_items?: number;
  total_unidades?: number;
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

type Pagina = {
  slug: string;
  titulo: string;
  contenido: string;
};

type ConfiguracionItem = {
  clave: string;
  valor: string;
  descripcion: string | null;
};

type ConfiguracionDraft = {
  dias_limite_retiro: string;
  puntos_referido_invitador: string;
  puntos_referido_invitado: string;
  longitud_codigo_invitacion: string;
};

type SucursalAdmin = {
  id: number;
  nombre: string;
  direccion: string;
  piso: string | null;
  localidad: string;
  provincia: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

type ConfirmacionCanje = {
  id: number;
  estado: "entregado" | "cancelado";
  producto: string;
  cliente: string;
};

type ProductoForm = {
  nombre: string;
  descripcion: string;
  categoria: string;
  puntos_requeridos: number | null;
  puntos_acumulables: number | null;
  imagenes: string[];
};

type UsuarioEditDraft = {
  nombre: string;
  email: string;
  rol: "cliente" | "vendedor" | "admin";
  dni: string;
  telefono: string;
};

type EditorDraft = {
  titulo: string;
  contenido: string;
  okMsg: string;
  errMsg: string;
};

type SucursalForm = {
  nombre: string;
  direccion: string;
  piso: string;
  localidad: string;
  provincia: string;
};

type StaticPageSlug = "sobre-nosotros" | "terminos";

const MOVIMIENTOS_INICIO_POR_PAGINA = 5;
const LISTA_POR_PAGINA = 5;
const INTENTOS_SEGURIDAD_POR_PAGINA = 5;
const MAX_PRODUCT_IMAGES = 3;

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDownloadFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/[/\\?%*:|"<>]/g, "_");
    } catch {
      return utf8Match[1].replace(/[/\\?%*:|"<>]/g, "_");
    }
  }

  const asciiMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (!asciiMatch?.[1]) return fallback;
  return asciiMatch[1].replace(/[/\\?%*:|"<>]/g, "_");
}

function getCanjeCode(canje: Pick<CanjeAdmin, "id" | "codigo_retiro">): string {
  if (!canje.codigo_retiro || /^C0{2,}[A-Z0-9]*$/.test(canje.codigo_retiro)) return "Generando...";
  return canje.codigo_retiro;
}

function formatMovimientoTipo(tipo: string): string {
  const labels: Record<string, string> = {
    asignacion_manual: "Asignacion manual",
    codigo_canje: "Canje de codigo",
    referido_invitador: "Puntos por invitar",
    referido_invitado: "Puntos por registro referido",
    canje_producto: "Canje de producto",
    devolucion_canje: "Devolucion por canje",
    ajuste: "Ajuste",
  };
  return labels[tipo] ?? tipo.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRolLabel(rol: Usuario["rol"]): string {
  if (rol === "admin") return "Administrador";
  if (rol === "vendedor") return "Vendedor";
  return "Cliente";
}

function formatEstadoCanje(estado: string): string {
  const labels: Record<string, string> = {
    pendiente: "Pendiente",
    entregado: "Entregado",
    no_disponible: "No disponible",
    expirado: "Expirado",
    cancelado: "Cancelado",
  };
  return labels[estado] ?? estado.replace(/_/g, " ");
}

function emptyProductoForm(): ProductoForm {
  return {
    nombre: "",
    descripcion: "",
    categoria: "",
    puntos_requeridos: null,
    puntos_acumulables: null,
    imagenes: [],
  };
}

function normalizeImageList(urls: string[]): string[] {
  return urls
    .map((url) => url.trim())
    .filter((url) => Boolean(url))
    .slice(0, MAX_PRODUCT_IMAGES);
}

function emptySucursalForm(): SucursalForm {
  return {
    nombre: "",
    direccion: "",
    piso: "",
    localidad: "",
    provincia: "",
  };
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="admin-section-header">
      <h2 className="admin-section-title">{title}</h2>
    </div>
  );
}

function FieldLabel({ text, tip }: { text: string; tip: string }) {
  return (
    <label className="adm-label">
      {text}
      <span className="adm-tip" data-tip={tip}>
        ?
      </span>
    </label>
  );
}

function PaginationControls({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="admin-pagination">
      <button className="admin-page-btn" onClick={onPrev} disabled={page <= 1}>
        Anterior
      </button>
      <span className="admin-page-label">
        Pagina {page} de {totalPages}
      </span>
      <button className="admin-page-btn" onClick={onNext} disabled={page >= totalPages}>
        Siguiente
      </button>
    </div>
  );
}

export function Admin() {
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<AdminTab>("inicio");
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileAdminNavOpen, setMobileAdminNavOpen] = useState(false);
  const [inicioMovimientosOpen, setInicioMovimientosOpen] = useState<boolean>(
    () => (typeof window !== "undefined" ? window.innerWidth > 640 : true)
  );
  const [inicioSeguridadOpen, setInicioSeguridadOpen] = useState<boolean>(
    () => (typeof window !== "undefined" ? window.innerWidth > 640 : true)
  );

  const [nuevoProducto, setNuevoProducto] = useState<ProductoForm>(emptyProductoForm());
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ProductoForm>(emptyProductoForm());
  const [editUsuarioId, setEditUsuarioId] = useState<number | null>(null);
  const [editUsuarioDraft, setEditUsuarioDraft] = useState<UsuarioEditDraft>({
    nombre: "",
    email: "",
    rol: "cliente",
    dni: "",
    telefono: "",
  });
  const [adminHint, setAdminHint] = useState("");

  const [nuevaCategoria, setNuevaCategoria] = useState({ nombre: "" });
  const [nuevoCodigo, setNuevoCodigo] = useState<{
    codigo: string;
    puntos_valor: number | null;
    usos_maximos: number | null;
    fecha_expiracion: string;
  }>({
    codigo: "",
    puntos_valor: null,
    usos_maximos: null,
    fecha_expiracion: "",
  });
  const [nuevoUsuario, setNuevoUsuario] = useState({
    email: "",
    password: "",
    nombre: "",
    rol: "vendedor" as "cliente" | "vendedor" | "admin",
    dni: "",
  });
  const [busquedaUsuarios, setBusquedaUsuarios] = useState("");
  const [busquedaProductos, setBusquedaProductos] = useState("");
  const [movimientosInicioPage, setMovimientosInicioPage] = useState(1);
  const [usuariosPage, setUsuariosPage] = useState(1);
  const [productosPage, setProductosPage] = useState(1);
  const [categoriasPage, setCategoriasPage] = useState(1);
  const [transaccionesPage, setTransaccionesPage] = useState(1);
  const [canjesPage, setCanjesPage] = useState(1);
  const [codigosPage, setCodigosPage] = useState(1);
  const [sucursalesPage, setSucursalesPage] = useState(1);
  const [seguridadPage, setSeguridadPage] = useState(1);
  const [asignacionUsuarioId, setAsignacionUsuarioId] = useState<number | null>(null);
  const [asignacionPuntos, setAsignacionPuntos] = useState("100");
  const [asignacionDescripcion, setAsignacionDescripcion] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState("");
  const [configErr, setConfigErr] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [backupErr, setBackupErr] = useState("");
  const [configDraft, setConfigDraft] = useState<ConfiguracionDraft>({
    dias_limite_retiro: "7",
    puntos_referido_invitador: "50",
    puntos_referido_invitado: "30",
    longitud_codigo_invitacion: "9",
  });
  const [nuevaSucursal, setNuevaSucursal] = useState<SucursalForm>(emptySucursalForm());
  const [editSucursalId, setEditSucursalId] = useState<number | null>(null);
  const [editSucursalDraft, setEditSucursalDraft] = useState<SucursalForm>(emptySucursalForm());

  const [sobreDraft, setSobreDraft] = useState<EditorDraft>({
    titulo: "",
    contenido: "",
    okMsg: "",
    errMsg: "",
  });
  const [terminosDraft, setTerminosDraft] = useState<EditorDraft>({
    titulo: "",
    contenido: "",
    okMsg: "",
    errMsg: "",
  });

  const [confirmacion, setConfirmacion] = useState<ConfirmacionCanje | null>(null);
  const [codigoCanjeAdmin, setCodigoCanjeAdmin] = useState("");
  const [canjeCodigoAdmin, setCanjeCodigoAdmin] = useState<CanjeCodigoAdmin | null>(null);
  const [canjeCodigoAdminErr, setCanjeCodigoAdminErr] = useState("");
  const [canjeCodigoAdminOk, setCanjeCodigoAdminOk] = useState("");
  const [buscandoCanjeAdmin, setBuscandoCanjeAdmin] = useState(false);
  const [procesandoCanjeAdmin, setProcesandoCanjeAdmin] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<Stats>("/admin/stats"),
  });

  const usuariosQuery = useQuery({
    queryKey: ["admin", "usuarios"],
    queryFn: () => api.get<Usuario[]>("/admin/usuarios"),
  });

  const movimientosQuery = useQuery({
    queryKey: ["admin", "movimientos"],
    queryFn: () => api.get<Movimiento[]>("/admin/movimientos"),
  });

  const productosQuery = useQuery({
    queryKey: ["admin", "productos"],
    queryFn: () => api.get<ProductoAdmin[]>("/admin/productos"),
  });

  const categoriasQuery = useQuery({
    queryKey: ["admin", "categorias"],
    queryFn: () => api.get<Categoria[]>("/admin/categorias"),
  });

  const codigosQuery = useQuery({
    queryKey: ["admin", "codigos"],
    queryFn: () => api.get<Codigo[]>("/admin/codigos"),
  });

  const canjesQuery = useQuery({
    queryKey: ["admin", "canjes"],
    queryFn: () => api.get<CanjeAdmin[]>("/admin/canjes"),
  });

  const sucursalesQuery = useQuery({
    queryKey: ["admin", "sucursales"],
    queryFn: () => api.get<SucursalAdmin[]>("/admin/sucursales"),
  });

  const configuracionQuery = useQuery({
    queryKey: ["admin", "configuracion"],
    queryFn: () => api.get<ConfiguracionItem[]>("/admin/configuracion"),
  });

  const securityMonitorQuery = useQuery({
    queryKey: ["admin", "security-monitor"],
    queryFn: () => api.get<SecurityMonitorResponse>("/admin/security/monitor?limit=80"),
  });

  const sobreQuery = useQuery({
    queryKey: ["admin", "paginas", "sobre-nosotros"],
    queryFn: () => api.get<Pagina>("/admin/paginas/sobre-nosotros"),
  });

  const terminosQuery = useQuery({
    queryKey: ["admin", "paginas", "terminos"],
    queryFn: () => api.get<Pagina>("/admin/paginas/terminos"),
  });

  useEffect(() => {
    if (!sobreQuery.data) return;
    setSobreDraft((prev) =>
      prev.titulo || prev.contenido
        ? prev
        : {
            ...prev,
            titulo: sobreQuery.data.titulo,
            contenido: sobreQuery.data.contenido,
          },
    );
  }, [sobreQuery.data]);

  useEffect(() => {
    if (!terminosQuery.data) return;
    setTerminosDraft((prev) =>
      prev.titulo || prev.contenido
        ? prev
        : {
            ...prev,
            titulo: terminosQuery.data.titulo,
            contenido: terminosQuery.data.contenido,
          },
    );
  }, [terminosQuery.data]);

  useEffect(() => {
    if (!adminHint) return;
    const timer = window.setTimeout(() => setAdminHint(""), 5200);
    return () => window.clearTimeout(timer);
  }, [adminHint]);

  useEffect(() => {
    if (!configuracionQuery.data) return;
    if (configLoaded) return;
    const getConfig = (clave: keyof ConfiguracionDraft, fallback: string) =>
      configuracionQuery.data?.find((item) => item.clave === clave)?.valor ?? fallback;
    setConfigDraft({
      dias_limite_retiro: getConfig("dias_limite_retiro", "7"),
      puntos_referido_invitador: getConfig("puntos_referido_invitador", "50"),
      puntos_referido_invitado: getConfig("puntos_referido_invitado", "30"),
      longitud_codigo_invitacion: getConfig("longitud_codigo_invitacion", "9"),
    });
    setConfigLoaded(true);
  }, [configLoaded, configuracionQuery.data]);

  const uploadImageMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("imagen", file);
      return api.post<{ url: string }>("/admin/productos/upload", form);
    },
  });

  const commandMutation = useMutation({
    mutationFn: async ({
      method,
      path,
      body,
    }: {
      method: "post" | "put" | "patch" | "delete";
      path: string;
      body?: unknown;
    }) => {
      if (method === "post") return api.post(path, body as Record<string, unknown>);
      if (method === "put") return api.put(path, body as Record<string, unknown>);
      if (method === "patch") return api.patch(path, body as Record<string, unknown>);
      return api.delete(path);
    },
  });

  async function refreshQueries(keys: Array<readonly string[]>) {
    await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
  }

  const productos = productosQuery.data ?? [];
  const usuarios = usuariosQuery.data ?? [];
  const movimientos = movimientosQuery.data ?? [];
  const categorias = categoriasQuery.data ?? [];
  const codigos = codigosQuery.data ?? [];
  const canjes = canjesQuery.data ?? [];
  const sucursales = sucursalesQuery.data ?? [];
  const securityEvents = securityMonitorQuery.data?.persistidos ?? [];
  const blockedAccessEvents = useMemo(
    () =>
      securityEvents
        .filter((event) => event.evento === "acceso_ruta_restringida_bloqueado")
        .slice(0, 20),
    [securityEvents]
  );
  const totalSeguridadPages = Math.max(1, Math.ceil(blockedAccessEvents.length / INTENTOS_SEGURIDAD_POR_PAGINA));
  const totalMovimientosInicioPages = Math.max(1, Math.ceil(movimientos.length / MOVIMIENTOS_INICIO_POR_PAGINA));

  useEffect(() => {
    setMovimientosInicioPage((prev) => Math.min(prev, totalMovimientosInicioPages));
  }, [totalMovimientosInicioPages]);

  const movimientosInicioPagina = useMemo(() => {
    const start = (movimientosInicioPage - 1) * MOVIMIENTOS_INICIO_POR_PAGINA;
    return movimientos.slice(start, start + MOVIMIENTOS_INICIO_POR_PAGINA);
  }, [movimientos, movimientosInicioPage]);

  const usuariosFiltrados = useMemo(() => {
    const q = busquedaUsuarios.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter((usuario) => {
      const haystack = [
        usuario.nombre,
        usuario.email,
        usuario.rol,
        usuario.dni || "",
        String(usuario.puntos_saldo),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [usuarios, busquedaUsuarios]);

  const productosFiltrados = useMemo(() => {
    const q = busquedaProductos.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((producto) => {
      const haystack = [
        producto.nombre,
        producto.descripcion || "",
        producto.categoria || "",
        String(producto.puntos_requeridos),
        String(producto.puntos_acumulables ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [productos, busquedaProductos]);

  const totalUsuariosPages = Math.max(1, Math.ceil(usuariosFiltrados.length / LISTA_POR_PAGINA));
  const totalProductosPages = Math.max(1, Math.ceil(productosFiltrados.length / LISTA_POR_PAGINA));
  const totalCategoriasPages = Math.max(1, Math.ceil(categorias.length / LISTA_POR_PAGINA));
  const totalTransaccionesPages = Math.max(1, Math.ceil(movimientos.length / LISTA_POR_PAGINA));
  const totalCanjesPages = Math.max(1, Math.ceil(canjes.length / LISTA_POR_PAGINA));
  const totalCodigosPages = Math.max(1, Math.ceil(codigos.length / LISTA_POR_PAGINA));
  const totalSucursalesPages = Math.max(1, Math.ceil(sucursales.length / LISTA_POR_PAGINA));

  useEffect(() => {
    setUsuariosPage((prev) => Math.min(prev, totalUsuariosPages));
  }, [totalUsuariosPages]);

  useEffect(() => {
    setProductosPage((prev) => Math.min(prev, totalProductosPages));
  }, [totalProductosPages]);

  useEffect(() => {
    setCategoriasPage((prev) => Math.min(prev, totalCategoriasPages));
  }, [totalCategoriasPages]);

  useEffect(() => {
    setTransaccionesPage((prev) => Math.min(prev, totalTransaccionesPages));
  }, [totalTransaccionesPages]);

  useEffect(() => {
    setCanjesPage((prev) => Math.min(prev, totalCanjesPages));
  }, [totalCanjesPages]);

  useEffect(() => {
    setCodigosPage((prev) => Math.min(prev, totalCodigosPages));
  }, [totalCodigosPages]);

  useEffect(() => {
    setSucursalesPage((prev) => Math.min(prev, totalSucursalesPages));
  }, [totalSucursalesPages]);

  useEffect(() => {
    setSeguridadPage((prev) => Math.min(prev, totalSeguridadPages));
  }, [totalSeguridadPages]);

  const blockedAccessEventsPagina = useMemo(() => {
    const start = (seguridadPage - 1) * INTENTOS_SEGURIDAD_POR_PAGINA;
    return blockedAccessEvents.slice(start, start + INTENTOS_SEGURIDAD_POR_PAGINA);
  }, [blockedAccessEvents, seguridadPage]);

  const usuariosPagina = useMemo(() => {
    const start = (usuariosPage - 1) * LISTA_POR_PAGINA;
    return usuariosFiltrados.slice(start, start + LISTA_POR_PAGINA);
  }, [usuariosFiltrados, usuariosPage]);

  const productosPagina = useMemo(() => {
    const start = (productosPage - 1) * LISTA_POR_PAGINA;
    return productosFiltrados.slice(start, start + LISTA_POR_PAGINA);
  }, [productosFiltrados, productosPage]);

  const categoriasPagina = useMemo(() => {
    const start = (categoriasPage - 1) * LISTA_POR_PAGINA;
    return categorias.slice(start, start + LISTA_POR_PAGINA);
  }, [categorias, categoriasPage]);

  const transaccionesPagina = useMemo(() => {
    const start = (transaccionesPage - 1) * LISTA_POR_PAGINA;
    return movimientos.slice(start, start + LISTA_POR_PAGINA);
  }, [movimientos, transaccionesPage]);

  const canjesPagina = useMemo(() => {
    const start = (canjesPage - 1) * LISTA_POR_PAGINA;
    return canjes.slice(start, start + LISTA_POR_PAGINA);
  }, [canjes, canjesPage]);

  const codigosPagina = useMemo(() => {
    const start = (codigosPage - 1) * LISTA_POR_PAGINA;
    return codigos.slice(start, start + LISTA_POR_PAGINA);
  }, [codigos, codigosPage]);

  const sucursalesPagina = useMemo(() => {
    const start = (sucursalesPage - 1) * LISTA_POR_PAGINA;
    return sucursales.slice(start, start + LISTA_POR_PAGINA);
  }, [sucursales, sucursalesPage]);

  const sobreImagenes = useMemo(
    () => extractPageImageUrls(sobreDraft.contenido || "").slice(0, MAX_STATIC_PAGE_IMAGES),
    [sobreDraft.contenido],
  );
  const terminosImagenes = useMemo(
    () => extractPageImageUrls(terminosDraft.contenido || "").slice(0, MAX_STATIC_PAGE_IMAGES),
    [terminosDraft.contenido],
  );

  const sobreHtml = useMemo(() => renderSafeMarkdown(stripPageImages(sobreDraft.contenido || "")), [sobreDraft.contenido]);
  const terminosHtml = useMemo(() => renderSafeMarkdown(stripPageImages(terminosDraft.contenido || "")), [terminosDraft.contenido]);

  async function subirImagenProducto(file: File, target: "nuevo" | "edit") {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrMsg("Solo puedes subir archivos de imagen.");
      return;
    }

    const currentCount = target === "nuevo" ? nuevoProducto.imagenes.length : editDraft.imagenes.length;
    if (currentCount >= MAX_PRODUCT_IMAGES) {
      setErrMsg(`Solo puedes cargar hasta ${MAX_PRODUCT_IMAGES} imágenes por producto.`);
      return;
    }

    setBusy(true);
    setErrMsg("");
    try {
      const upload = await uploadImageMutation.mutateAsync(file);
      if (target === "nuevo") {
        setNuevoProducto((prev) => ({ ...prev, imagenes: normalizeImageList([...prev.imagenes, upload.url]) }));
      } else {
        setEditDraft((prev) => ({ ...prev, imagenes: normalizeImageList([...prev.imagenes, upload.url]) }));
      }
      setAdminHint("Imagen cargada. Puedes arrastrar otra foto o guardar el producto.");
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function manejarDropImagenesProducto(
    event: DragEvent<HTMLDivElement>,
    target: "nuevo" | "edit"
  ) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    if (!files.length) return;

    const current = target === "nuevo" ? nuevoProducto.imagenes.length : editDraft.imagenes.length;
    const slotsAvailable = Math.max(0, MAX_PRODUCT_IMAGES - current);
    const accepted = files.filter((file) => file.type.startsWith("image/")).slice(0, slotsAvailable);
    if (!accepted.length) {
      setErrMsg(`Arrastra imágenes válidas. Máximo ${MAX_PRODUCT_IMAGES} por producto.`);
      return;
    }

    for (const file of accepted) {
      // Subida secuencial para mantener el orden de las imágenes.
      // eslint-disable-next-line no-await-in-loop
      await subirImagenProducto(file, target);
    }
  }

  function quitarImagenProducto(target: "nuevo" | "edit", index: number) {
    if (target === "nuevo") {
      setNuevoProducto((prev) => ({ ...prev, imagenes: prev.imagenes.filter((_, idx) => idx !== index) }));
      return;
    }
    setEditDraft((prev) => ({ ...prev, imagenes: prev.imagenes.filter((_, idx) => idx !== index) }));
  }

  async function crearProducto() {
    setErrMsg("");
    setOkMsg("");
    if (!nuevoProducto.nombre.trim()) {
      setErrMsg("El nombre del producto es obligatorio.");
      return;
    }

    if (!nuevoProducto.puntos_requeridos || nuevoProducto.puntos_requeridos <= 0) {
      setErrMsg("Los puntos requeridos deben ser mayores a 0.");
      return;
    }

    setBusy(true);
    try {
      const imagenes = normalizeImageList(nuevoProducto.imagenes);
      const imagenUrl = imagenes[0] ?? null;

      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/productos",
        body: {
          nombre: nuevoProducto.nombre.trim(),
          descripcion: nuevoProducto.descripcion || null,
          categoria: nuevoProducto.categoria || null,
          puntos_requeridos: Number(nuevoProducto.puntos_requeridos),
          puntos_acumulables: nuevoProducto.puntos_acumulables ? Number(nuevoProducto.puntos_acumulables) : null,
          imagenes,
          imagen_url: imagenUrl,
        },
      });

      setNuevoProducto(emptyProductoForm());
      setOkMsg("Producto creado correctamente.");
      await refreshQueries([["admin", "productos"], ["admin", "stats"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(producto: ProductoAdmin) {
    setEditId(producto.id);
    setEditDraft({
      nombre: producto.nombre,
      descripcion: producto.descripcion || "",
      categoria: producto.categoria || "",
      puntos_requeridos: producto.puntos_requeridos,
      puntos_acumulables: producto.puntos_acumulables,
      imagenes: normalizeImageList(producto.imagenes ?? (producto.imagen_url ? [producto.imagen_url] : [])),
    });
  }

  async function saveEdit(productoId: number) {
    setErrMsg("");
    setOkMsg("");
    if (!editDraft.puntos_requeridos || editDraft.puntos_requeridos <= 0) {
      setErrMsg("Los puntos requeridos deben ser mayores a 0.");
      return;
    }
    setBusy(true);
    try {
      const imagenes = normalizeImageList(editDraft.imagenes);
      const imagenUrl = imagenes[0] ?? null;

      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/productos/${productoId}`,
        body: {
          nombre: editDraft.nombre.trim(),
          descripcion: editDraft.descripcion || null,
          categoria: editDraft.categoria || null,
          puntos_requeridos: Number(editDraft.puntos_requeridos),
          puntos_acumulables: editDraft.puntos_acumulables ? Number(editDraft.puntos_acumulables) : null,
          imagenes,
          imagen_url: imagenUrl,
        },
      });

      setEditId(null);
      setOkMsg("Producto actualizado.");
      await refreshQueries([["admin", "productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleProductoActivo(producto: ProductoAdmin) {
    setErrMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/productos/${producto.id}/activo`,
        body: { activo: !producto.activo },
      });
      await refreshQueries([["admin", "productos"], ["admin", "stats"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    }
  }

  async function crearCategoria() {
    setErrMsg("");
    setOkMsg("");
    if (!nuevaCategoria.nombre.trim()) {
      setErrMsg("El nombre de categoria es obligatorio.");
      return;
    }

    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/categorias",
        body: {
          nombre: nuevaCategoria.nombre.trim(),
        },
      });
      setNuevaCategoria({ nombre: "" });
      setOkMsg("Categoria creada.");
      await refreshQueries([["admin", "categorias"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleUsuarioActivo(usuario: Usuario) {
    setErrMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/usuarios/${usuario.id}/activo`,
        body: { activo: !usuario.activo },
      });
      await refreshQueries([["admin", "usuarios"], ["admin", "stats"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    }
  }

  function iniciarEdicionUsuario(usuario: Usuario) {
    setEditUsuarioId(usuario.id);
    setEditUsuarioDraft({
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      dni: usuario.dni || "",
      telefono: usuario.telefono || "",
    });
    setErrMsg("");
    setOkMsg("");
  }

  function cancelarEdicionUsuario() {
    setEditUsuarioId(null);
    setEditUsuarioDraft({
      nombre: "",
      email: "",
      rol: "cliente",
      dni: "",
      telefono: "",
    });
  }

  async function guardarEdicionUsuario(usuarioId: number) {
    setErrMsg("");
    setOkMsg("");
    if (!editUsuarioDraft.nombre.trim() || !editUsuarioDraft.email.trim()) {
      setErrMsg("Nombre y email son obligatorios para editar usuario.");
      return;
    }
    if (editUsuarioDraft.rol === "cliente" && !editUsuarioDraft.dni.trim()) {
      setErrMsg("El DNI es obligatorio para usuarios con rol cliente.");
      return;
    }

    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/usuarios/${usuarioId}`,
        body: {
          nombre: editUsuarioDraft.nombre.trim(),
          email: editUsuarioDraft.email.trim().toLowerCase(),
          rol: editUsuarioDraft.rol,
          dni: editUsuarioDraft.dni.trim() || null,
          telefono: editUsuarioDraft.telefono.trim() || null,
        },
      });
      setOkMsg("Usuario actualizado.");
      cancelarEdicionUsuario();
      await refreshQueries([["admin", "usuarios"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function abrirAsignacion(usuario: Usuario) {
    setAsignacionUsuarioId(usuario.id);
    setAsignacionPuntos("100");
    setAsignacionDescripcion("");
    setErrMsg("");
    setOkMsg("");
  }

  function cancelarAsignacion() {
    setAsignacionUsuarioId(null);
    setAsignacionPuntos("100");
    setAsignacionDescripcion("");
  }

  async function asignarPuntosManual() {
    if (!asignacionUsuarioId) return;
    const puntos = Number(asignacionPuntos);
    if (!Number.isFinite(puntos) || !Number.isInteger(puntos) || puntos <= 0) {
      setErrMsg("Ingresa una cantidad entera de puntos mayor a 0.");
      return;
    }

    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/puntos",
        body: {
          usuario_id: asignacionUsuarioId,
          puntos,
          descripcion: asignacionDescripcion.trim() || "Asignacion manual desde panel admin",
          tipo: "asignacion_manual",
        },
      });
      setOkMsg(`Se asignaron ${puntos} puntos correctamente.`);
      cancelarAsignacion();
      await refreshQueries([["admin", "usuarios"], ["admin", "stats"], ["admin", "movimientos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function crearCodigo() {
    setErrMsg("");
    setOkMsg("");
    if (!nuevoCodigo.codigo.trim()) {
      setErrMsg("El codigo es obligatorio.");
      return;
    }
    if (!nuevoCodigo.puntos_valor || Number(nuevoCodigo.puntos_valor) <= 0) {
      setErrMsg("Los puntos deben ser mayores a 0.");
      return;
    }
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/codigos",
        body: {
          codigo: nuevoCodigo.codigo.trim().toUpperCase(),
          puntos_valor: Number(nuevoCodigo.puntos_valor),
          usos_maximos: nuevoCodigo.usos_maximos !== null && Number(nuevoCodigo.usos_maximos) >= 0 ? Number(nuevoCodigo.usos_maximos) : 1,
          fecha_expiracion: nuevoCodigo.fecha_expiracion ? new Date(nuevoCodigo.fecha_expiracion).toISOString() : null,
        },
      });
      setNuevoCodigo({ codigo: "", puntos_valor: null, usos_maximos: null, fecha_expiracion: "" });
      setOkMsg("Codigo creado.");
      await refreshQueries([["admin", "codigos"], ["admin", "stats"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCodigo(codigo: Codigo) {
    setErrMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/codigos/${codigo.id}`,
        body: { activo: !codigo.activo },
      });
      await refreshQueries([["admin", "codigos"], ["admin", "stats"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    }
  }

  async function crearUsuario() {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/usuarios",
        body: {
          nombre: nuevoUsuario.nombre,
          email: nuevoUsuario.email,
          password: nuevoUsuario.password,
          rol: nuevoUsuario.rol,
          dni: nuevoUsuario.rol === "cliente" ? nuevoUsuario.dni : undefined,
        },
      });
      setNuevoUsuario({ email: "", password: "", nombre: "", rol: "vendedor", dni: "" });
      setOkMsg("Usuario creado.");
      await refreshQueries([["admin", "usuarios"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function actualizarEstadoCanje(id: number, estado: "entregado" | "cancelado") {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/canjes/${id}`,
        body: { estado },
      });
      
      const msg = estado === "entregado" 
        ? "¡Canje marcado como entregado!" 
        : "Canje anulado correctamente. Los puntos han sido devueltos al cliente.";
      setOkMsg(msg);
      
      await refreshQueries([["admin", "canjes"], ["admin", "stats"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
      setConfirmacion(null);
    }
  }

  async function buscarCanjeCodigoAdmin() {
    const codigo = codigoCanjeAdmin.trim().toUpperCase();
    if (!codigo) return;
    setCanjeCodigoAdminErr("");
    setCanjeCodigoAdminOk("");
    setCanjeCodigoAdmin(null);
    setBuscandoCanjeAdmin(true);
    try {
      const data = await api.get<CanjeCodigoAdmin>(`/vendedor/canje/${codigo}`);
      setCanjeCodigoAdmin(data);
    } catch (error) {
      setCanjeCodigoAdminErr((error as Error).message);
    } finally {
      setBuscandoCanjeAdmin(false);
    }
  }

  async function procesarCanjeCodigoAdmin(estado: "entregado" | "no_disponible" | "cancelado") {
    if (!canjeCodigoAdmin) return;
    setCanjeCodigoAdminErr("");
    setCanjeCodigoAdminOk("");
    setProcesandoCanjeAdmin(true);
    try {
      await api.patch(`/vendedor/canje/${canjeCodigoAdmin.codigo_retiro}`, { estado });
      setCanjeCodigoAdmin((prev) => (prev ? { ...prev, estado } : prev));
      setCanjeCodigoAdminOk(
        estado === "entregado"
          ? "Canje marcado como entregado."
          : estado === "no_disponible"
          ? "Canje marcado como no disponible. Puntos devueltos al cliente."
          : "Canje cancelado. Puntos devueltos al cliente."
      );
      await refreshQueries([["admin", "canjes"], ["admin", "stats"]]);
    } catch (error) {
      setCanjeCodigoAdminErr((error as Error).message);
    } finally {
      setProcesandoCanjeAdmin(false);
    }
  }

  function prepararConfirmacion(canje: CanjeAdmin, nuevoEstado: "entregado" | "cancelado") {
    setConfirmacion({
      id: canje.id,
      estado: nuevoEstado,
      producto: canje.producto_nombre,
      cliente: canje.cliente_nombre
    });
  }

  async function generarBackupCompleto() {
    setBackupErr("");
    setBackupMsg("");
    setBackupBusy(true);

    try {
      const response = await fetch(apiUrl("/api/admin/backup/full"), {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": getCsrfToken(),
        },
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "No se pudo generar el backup completo.");
      }

      const blob = await response.blob();
      const fallbackName = `backup-full-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      const fileName = getDownloadFilename(response.headers.get("content-disposition"), fallbackName);

      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
      setBackupMsg(`Backup generado y descargado (${sizeMb} MB).`);
    } catch (error) {
      setBackupErr((error as Error).message);
    } finally {
      setBackupBusy(false);
    }
  }

  async function guardarConfiguracionGeneral() {
    setConfigErr("");
    setConfigMsg("");

    const diasLimiteRetiro = Number(configDraft.dias_limite_retiro);
    const puntosInvitador = Number(configDraft.puntos_referido_invitador);
    const puntosInvitado = Number(configDraft.puntos_referido_invitado);
    const longitudCodigoInvitacion = Number(configDraft.longitud_codigo_invitacion);

    if (!Number.isInteger(diasLimiteRetiro) || diasLimiteRetiro <= 0 || diasLimiteRetiro > 90) {
      setConfigErr("Los dias limite de retiro deben ser un numero entero entre 1 y 90.");
      return;
    }
    if (!Number.isInteger(puntosInvitador) || puntosInvitador < 0 || puntosInvitador > 100000) {
      setConfigErr("Los puntos para el invitador deben ser un numero entero entre 0 y 100000.");
      return;
    }
    if (!Number.isInteger(puntosInvitado) || puntosInvitado < 0 || puntosInvitado > 100000) {
      setConfigErr("Los puntos para el invitado deben ser un numero entero entre 0 y 100000.");
      return;
    }
    if (!Number.isInteger(longitudCodigoInvitacion) || longitudCodigoInvitacion < 6 || longitudCodigoInvitacion > 20) {
      setConfigErr("La longitud del codigo de invitacion debe ser un entero entre 6 y 20.");
      return;
    }

    setConfigBusy(true);
    try {
      const updates = [
        {
          clave: "dias_limite_retiro",
          valor: String(diasLimiteRetiro),
          descripcion: "Dias que tiene el cliente para retirar un producto canjeado antes de que expire.",
        },
        {
          clave: "puntos_referido_invitador",
          valor: String(puntosInvitador),
          descripcion: "Puntos que gana quien comparte su codigo de invitacion.",
        },
        {
          clave: "puntos_referido_invitado",
          valor: String(puntosInvitado),
          descripcion: "Puntos que gana quien se registra usando un codigo de invitacion.",
        },
        {
          clave: "longitud_codigo_invitacion",
          valor: String(longitudCodigoInvitacion),
          descripcion: "Longitud del codigo de invitacion generado automaticamente.",
        },
      ];

      await Promise.all(
        updates.map((item) =>
          commandMutation.mutateAsync({
            method: "put",
            path: `/admin/configuracion/${item.clave}`,
            body: { valor: item.valor, descripcion: item.descripcion },
          }),
        ),
      );

      setConfigMsg("Configuracion general actualizada.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "configuracion"] });
    } catch (error) {
      setConfigErr((error as Error).message);
    } finally {
      setConfigBusy(false);
    }
  }

  function iniciarEdicionSucursal(sucursal: SucursalAdmin) {
    setEditSucursalId(sucursal.id);
    setEditSucursalDraft({
      nombre: sucursal.nombre,
      direccion: sucursal.direccion,
      piso: sucursal.piso || "",
      localidad: sucursal.localidad,
      provincia: sucursal.provincia,
    });
  }

  async function crearSucursal() {
    setErrMsg("");
    setOkMsg("");
    if (!nuevaSucursal.nombre.trim() || !nuevaSucursal.direccion.trim() || !nuevaSucursal.localidad.trim() || !nuevaSucursal.provincia.trim()) {
      setErrMsg("Completa nombre, direccion, localidad y provincia para crear la sucursal.");
      return;
    }
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/sucursales",
        body: {
          nombre: nuevaSucursal.nombre.trim(),
          direccion: nuevaSucursal.direccion.trim(),
          piso: nuevaSucursal.piso.trim() || null,
          localidad: nuevaSucursal.localidad.trim(),
          provincia: nuevaSucursal.provincia.trim(),
        },
      });
      setNuevaSucursal(emptySucursalForm());
      setOkMsg("Sucursal creada.");
      await refreshQueries([["admin", "sucursales"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function guardarEdicionSucursal(sucursalId: number) {
    setErrMsg("");
    setOkMsg("");
    if (!editSucursalDraft.nombre.trim() || !editSucursalDraft.direccion.trim() || !editSucursalDraft.localidad.trim() || !editSucursalDraft.provincia.trim()) {
      setErrMsg("Completa nombre, direccion, localidad y provincia para guardar la sucursal.");
      return;
    }
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/sucursales/${sucursalId}`,
        body: {
          nombre: editSucursalDraft.nombre.trim(),
          direccion: editSucursalDraft.direccion.trim(),
          piso: editSucursalDraft.piso.trim() || null,
          localidad: editSucursalDraft.localidad.trim(),
          provincia: editSucursalDraft.provincia.trim(),
        },
      });
      setEditSucursalId(null);
      setOkMsg("Sucursal actualizada.");
      await refreshQueries([["admin", "sucursales"], ["admin", "canjes"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSucursalActiva(sucursal: SucursalAdmin) {
    setErrMsg("");
    setOkMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/sucursales/${sucursal.id}/activo`,
        body: { activo: !sucursal.activo },
      });
      setOkMsg(!sucursal.activo ? "Sucursal activada." : "Sucursal desactivada.");
      await refreshQueries([["admin", "sucursales"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    }
  }

  function normalizarContenidoPagina(contenido: string): string {
    const cuerpo = stripPageImages(contenido || "");
    const imagenes = extractPageImageUrls(contenido || "").slice(0, MAX_STATIC_PAGE_IMAGES);
    return rebuildPageContent(cuerpo, imagenes);
  }

  async function guardarPagina(slug: StaticPageSlug) {
    const draft = slug === "sobre-nosotros" ? sobreDraft : terminosDraft;
    const setDraft = slug === "sobre-nosotros" ? setSobreDraft : setTerminosDraft;
    const totalImagenes = extractPageImageUrls(draft.contenido || "").length;
    if (totalImagenes > MAX_STATIC_PAGE_IMAGES) {
      setDraft((prev) => ({
        ...prev,
        okMsg: "",
        errMsg: `Solo se permiten hasta ${MAX_STATIC_PAGE_IMAGES} fotos.`,
      }));
      return;
    }

    const contenidoNormalizado = normalizarContenidoPagina(draft.contenido || "");
    setDraft((prev) => ({ ...prev, okMsg: "", errMsg: "" }));
    try {
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/paginas/${slug}`,
        body: {
          titulo: draft.titulo.trim(),
          contenido: contenidoNormalizado,
        },
      });
      setDraft((prev) => ({
        ...prev,
        contenido: contenidoNormalizado,
        okMsg: "Guardado correctamente.",
      }));
      await queryClient.invalidateQueries({ queryKey: ["admin", "paginas", slug] });
    } catch (error) {
      setDraft((prev) => ({ ...prev, errMsg: (error as Error).message }));
    }
  }

  async function subirImagenPagina(slug: StaticPageSlug, file: File) {
    const draft = slug === "sobre-nosotros" ? sobreDraft : terminosDraft;
    const setDraft = slug === "sobre-nosotros" ? setSobreDraft : setTerminosDraft;
    const imagenesActuales = extractPageImageUrls(draft.contenido || "").slice(0, MAX_STATIC_PAGE_IMAGES);

    if (imagenesActuales.length >= MAX_STATIC_PAGE_IMAGES) {
      setDraft((prev) => ({
        ...prev,
        okMsg: "",
        errMsg: `Llegaste al maximo de ${MAX_STATIC_PAGE_IMAGES} fotos.`,
      }));
      return;
    }

    try {
      const upload = await uploadImageMutation.mutateAsync(file);
      setDraft((prev) => {
        const cuerpo = stripPageImages(prev.contenido || "");
        const imagenes = extractPageImageUrls(prev.contenido || "").slice(0, MAX_STATIC_PAGE_IMAGES);
        if (imagenes.length >= MAX_STATIC_PAGE_IMAGES) {
          return {
            ...prev,
            okMsg: "",
            errMsg: `Llegaste al maximo de ${MAX_STATIC_PAGE_IMAGES} fotos.`,
          };
        }
        return {
          ...prev,
          errMsg: "",
          contenido: rebuildPageContent(cuerpo, [...imagenes, upload.url]),
        };
      });
    } catch (error) {
      setDraft((prev) => ({ ...prev, errMsg: (error as Error).message }));
    }
  }

  function quitarImagenPagina(slug: StaticPageSlug, index: number) {
    const setDraft = slug === "sobre-nosotros" ? setSobreDraft : setTerminosDraft;
    setDraft((prev) => {
      const cuerpo = stripPageImages(prev.contenido || "");
      const imagenes = extractPageImageUrls(prev.contenido || "").slice(0, MAX_STATIC_PAGE_IMAGES);
      const actualizadas = imagenes.filter((_, imageIndex) => imageIndex !== index);
      return {
        ...prev,
        errMsg: "",
        contenido: rebuildPageContent(cuerpo, actualizadas),
      };
    });
  }

  const stats = statsQuery.data;
  const canjeCodigoAdminFinalizado = canjeCodigoAdmin
    ? ["entregado", "cancelado", "expirado"].includes(canjeCodigoAdmin.estado)
    : false;
  
  useEffect(() => {
    setMobileAdminNavOpen(false);
  }, [tab]);

  return (
    <section className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <p className="admin-brand-name">Administrador</p>
          <p className="admin-brand-role">Panel</p>
          <button
            type="button"
            className="admin-mobile-nav-toggle"
            onClick={() => setMobileAdminNavOpen((prev) => !prev)}
            aria-expanded={mobileAdminNavOpen}
            aria-controls="admin-nav-main"
          >
            {mobileAdminNavOpen ? "Cerrar menu" : "Menu"}
          </button>
        </div>

        <nav id="admin-nav-main" className={`admin-nav ${mobileAdminNavOpen ? "admin-nav-open" : ""}`}>
          <span className="admin-nav-section">General</span>
          <button className={`admin-nav-btn ${tab === "inicio" ? "active" : ""}`} onClick={() => setTab("inicio")}>
            Inicio
          </button>

          <span className="admin-nav-section">Gestion</span>
          <button className={`admin-nav-btn ${tab === "usuarios" ? "active" : ""}`} onClick={() => setTab("usuarios")}>
            Usuarios
          </button>
          <button className={`admin-nav-btn ${tab === "productos" ? "active" : ""}`} onClick={() => setTab("productos")}>
            Productos
          </button>
          <button className={`admin-nav-btn ${tab === "categorias" ? "active" : ""}`} onClick={() => setTab("categorias")}>
            Categorias
          </button>
          <button className={`admin-nav-btn ${tab === "transacciones" ? "active" : ""}`} onClick={() => setTab("transacciones")}>
            Transacciones
          </button>
          <button className={`admin-nav-btn ${tab === "canjes" ? "active" : ""}`} onClick={() => setTab("canjes")}>
            Canjes
          </button>
          <button className={`admin-nav-btn ${tab === "codigos" ? "active" : ""}`} onClick={() => setTab("codigos")}>
            Codigos
          </button>

          <span className="admin-nav-section">Configuracion</span>
          <button className={`admin-nav-btn ${tab === "crear" ? "active" : ""}`} onClick={() => setTab("crear")}>
            Crear usuario
          </button>
          <button className={`admin-nav-btn ${tab === "sobre-nosotros" ? "active" : ""}`} onClick={() => setTab("sobre-nosotros")}>
            Quienes Somos
          </button>
          <button className={`admin-nav-btn ${tab === "terminos" ? "active" : ""}`} onClick={() => setTab("terminos")}>
            Terminos
          </button>
        </nav>
      </aside>

      <main className="admin-main">
        <div className="admin-topbar">
          <div className="admin-topbar-main">
            <h1 className="admin-topbar-title">Panel de administracion</h1>
            <p className="admin-topbar-sub">Resumen del programa de puntos</p>
          </div>
          <div className="admin-topbar-actions">
            <div className="admin-topbar-date">{new Date().toLocaleDateString("es-AR")}</div>
          </div>
        </div>

        <div className="admin-content">
          <div className="admin-stats">
            <div className="admin-stat-card">
              <p className="admin-stat-label">Clientes</p>
              <p className="admin-stat-value">{stats?.clientes ?? "-"}</p>
            </div>
            <div className="admin-stat-card">
              <p className="admin-stat-label">Productos activos</p>
              <p className="admin-stat-value">{stats?.productos ?? "-"}</p>
            </div>
            <div className="admin-stat-card">
              <p className="admin-stat-label">Canjes pendientes</p>
              <p className="admin-stat-value accent">{stats?.canjes_pendientes ?? "-"}</p>
            </div>
            <div className="admin-stat-card">
              <p className="admin-stat-label">Puntos emitidos</p>
              <p className="admin-stat-value">{stats?.puntos_emitidos ?? "-"}</p>
            </div>
          </div>

          {errMsg ? <div className="adm-msg-err" style={{ marginBottom: "1rem" }}>{errMsg}</div> : null}
          {okMsg ? <div className="adm-msg-ok" style={{ marginBottom: "1rem" }}>{okMsg}</div> : null}
          {adminHint ? <div className="adm-floating-note">{adminHint}</div> : null}

          {tab === "inicio" ? (
            <>
              <div className="admin-section-header">
                <h2 className="admin-section-title">Ultimos movimientos</h2>
                <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                  <button className="adm-btn-link" onClick={() => setInicioMovimientosOpen((prev) => !prev)}>
                    {inicioMovimientosOpen ? "Ocultar" : "Mostrar"}
                  </button>
                  <button className="adm-btn-link" onClick={() => setTab("transacciones")}>
                    Ver todos
                  </button>
                </div>
              </div>

              {inicioMovimientosOpen ? (
                <div className="admin-card">
                  <div className="adm-mobile-list">
                    {movimientosInicioPagina.length === 0 ? (
                      <div className="adm-empty">No hay movimientos para mostrar.</div>
                    ) : (
                      movimientosInicioPagina.map((movimiento) => (
                        <div key={movimiento.id} className="adm-mobile-item">
                          <p className="adm-mobile-item-title">{movimiento.usuario_nombre}</p>
                          <p><strong>Tipo:</strong> {formatMovimientoTipo(movimiento.tipo)}</p>
                          <p className={movimiento.puntos >= 0 ? "adm-pts-pos" : "adm-pts-neg"}>
                            <strong>Puntos:</strong> {movimiento.puntos >= 0 ? "+" : ""}{movimiento.puntos}
                          </p>
                          <p><strong>Descripcion:</strong> {movimiento.descripcion || "-"}</p>
                          <p><strong>Fecha:</strong> {formatDate(movimiento.created_at)}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="admin-table-wrap adm-desktop-table">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Usuario</th>
                          <th>Tipo</th>
                          <th>Puntos</th>
                          <th>Descripcion</th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movimientosInicioPagina.length === 0 ? (
                          <tr>
                            <td colSpan={5}>
                              <div className="adm-empty">No hay movimientos para mostrar.</div>
                            </td>
                          </tr>
                        ) : null}
                        {movimientosInicioPagina.map((movimiento) => (
                          <tr key={movimiento.id}>
                            <td>{movimiento.usuario_nombre}</td>
                            <td>{formatMovimientoTipo(movimiento.tipo)}</td>
                            <td className={movimiento.puntos >= 0 ? "adm-pts-pos" : "adm-pts-neg"}>
                              {movimiento.puntos >= 0 ? "+" : ""}
                              {movimiento.puntos}
                            </td>
                            <td>{movimiento.descripcion || "-"}</td>
                            <td>{formatDate(movimiento.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    page={movimientosInicioPage}
                    totalPages={totalMovimientosInicioPages}
                    onPrev={() => setMovimientosInicioPage((prev) => Math.max(1, prev - 1))}
                    onNext={() => setMovimientosInicioPage((prev) => Math.min(totalMovimientosInicioPages, prev + 1))}
                  />
                </div>
              ) : null}

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Configuracion del programa</h2>
              </div>
              <div className="admin-card admin-card-padded adm-config-card">
                <p className="adm-config-subtitle">
                  Ajusta el vencimiento de canjes y la logica de puntos de referidos sin tocar codigo.
                </p>
                <div className="adm-config-grid">
                  <div className="adm-field">
                    <label className="adm-label">Dias limite de retiro</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      className="adm-input"
                      value={configDraft.dias_limite_retiro}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, dias_limite_retiro: event.target.value }))}
                      placeholder="Ej: 7"
                    />
                    <p className="adm-field-help">Cantidad de dias que tiene el cliente para retirar un canje antes de que expire.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Puntos para quien invita</label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      className="adm-input"
                      value={configDraft.puntos_referido_invitador}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, puntos_referido_invitador: event.target.value }))}
                      placeholder="Ej: 50"
                    />
                    <p className="adm-field-help">Puntos que recibe quien comparte su codigo cuando otra persona se registra.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Puntos para quien se registra</label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      className="adm-input"
                      value={configDraft.puntos_referido_invitado}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, puntos_referido_invitado: event.target.value }))}
                      placeholder="Ej: 30"
                    />
                    <p className="adm-field-help">Puntos que recibe el nuevo cliente al usar un codigo de invitacion valido.</p>
                  </div>
                </div>
                {configErr ? <div className="adm-msg-err">{configErr}</div> : null}
                {configMsg ? <div className="adm-msg-ok">{configMsg}</div> : null}
                <div className="adm-config-actions">
                  <button className="adm-btn-primary adm-btn-inline" onClick={guardarConfiguracionGeneral} disabled={configBusy}>
                    {configBusy ? "Guardando..." : "Guardar configuracion"}
                  </button>
                </div>
              </div>

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Backups de seguridad</h2>
              </div>
              <div className="admin-card admin-card-padded adm-config-card">
                <p className="adm-config-subtitle">
                  Genera un respaldo completo que incluye base de datos y carpeta de uploads.
                </p>
                {backupErr ? <div className="adm-msg-err">{backupErr}</div> : null}
                {backupMsg ? <div className="adm-msg-ok">{backupMsg}</div> : null}
                <div className="adm-config-actions">
                  <button className="adm-btn-primary adm-btn-inline" onClick={generarBackupCompleto} disabled={backupBusy}>
                    {backupBusy ? "Generando backup..." : "Generar y descargar backup completo"}
                  </button>
                </div>
              </div>

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Intentos de acceso bloqueados</h2>
                <button className="adm-btn-link" onClick={() => setInicioSeguridadOpen((prev) => !prev)}>
                  {inicioSeguridadOpen ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              {inicioSeguridadOpen ? (
                <div className="admin-card">
                  <div className="adm-mobile-list">
                    {securityMonitorQuery.isLoading ? (
                      <div className="adm-empty">Cargando eventos de seguridad...</div>
                    ) : null}
                    {!securityMonitorQuery.isLoading && blockedAccessEvents.length === 0 ? (
                      <div className="adm-empty">No hay intentos bloqueados recientes.</div>
                    ) : null}
                    {blockedAccessEventsPagina.map((event) => {
                      const detalles = event.detalles ?? {};
                      const usuarioNombre = typeof detalles.usuario_nombre === "string" ? detalles.usuario_nombre : null;
                      const usuarioEmail = typeof detalles.usuario_email === "string" ? detalles.usuario_email : null;
                      const usuarioRol = typeof detalles.usuario_rol === "string" ? detalles.usuario_rol : null;
                      const autenticado = Boolean(detalles.autenticado);
                      const attemptedPath =
                        typeof detalles.attempted_path === "string" ? detalles.attempted_path : event.ruta;
                      const requiredRoles = Array.isArray(detalles.required_roles)
                        ? detalles.required_roles.filter((value): value is string => typeof value === "string")
                        : [];

                      return (
                        <div key={event.id} className="adm-mobile-item">
                          <p className="adm-mobile-item-title">{formatDate(event.creado_en)}</p>
                          <p><strong>IP:</strong> {event.ip}</p>
                          <p>
                            <strong>Usuario:</strong>{" "}
                            {autenticado
                              ? `${usuarioNombre ?? "Usuario autenticado"}${usuarioEmail ? ` - ${usuarioEmail}` : ""}${usuarioRol ? ` (${usuarioRol})` : ""}`
                              : "No logueado/registrado"}
                          </p>
                          <p><strong>Intento:</strong> {attemptedPath}</p>
                          <p><strong>Permisos:</strong> {requiredRoles.length ? requiredRoles.join(", ") : "-"}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="admin-table-wrap adm-desktop-table">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>IP</th>
                          <th>Usuario</th>
                          <th>Intento</th>
                          <th>Permisos requeridos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {securityMonitorQuery.isLoading ? (
                          <tr>
                            <td colSpan={5}>
                              <div className="adm-empty">Cargando eventos de seguridad...</div>
                            </td>
                          </tr>
                        ) : null}
                        {!securityMonitorQuery.isLoading && blockedAccessEvents.length === 0 ? (
                          <tr>
                            <td colSpan={5}>
                              <div className="adm-empty">No hay intentos bloqueados recientes.</div>
                            </td>
                          </tr>
                        ) : null}
                        {blockedAccessEventsPagina.map((event) => {
                          const detalles = event.detalles ?? {};
                          const usuarioNombre = typeof detalles.usuario_nombre === "string" ? detalles.usuario_nombre : null;
                          const usuarioEmail = typeof detalles.usuario_email === "string" ? detalles.usuario_email : null;
                          const usuarioRol = typeof detalles.usuario_rol === "string" ? detalles.usuario_rol : null;
                          const autenticado = Boolean(detalles.autenticado);
                          const attemptedPath =
                            typeof detalles.attempted_path === "string" ? detalles.attempted_path : event.ruta;
                          const requiredRoles = Array.isArray(detalles.required_roles)
                            ? detalles.required_roles.filter((value): value is string => typeof value === "string")
                            : [];

                          return (
                            <tr key={event.id}>
                              <td>{formatDate(event.creado_en)}</td>
                              <td>{event.ip}</td>
                              <td>
                                {autenticado ? (
                                  <div style={{ display: "grid", gap: "0.15rem" }}>
                                    <strong>{usuarioNombre ?? "Usuario autenticado"}</strong>
                                    <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>
                                      {usuarioEmail ?? "-"}{usuarioRol ? ` (${usuarioRol})` : ""}
                                    </span>
                                  </div>
                                ) : (
                                  <span>No logueado/registrado</span>
                                )}
                              </td>
                              <td>{attemptedPath}</td>
                              <td>{requiredRoles.length ? requiredRoles.join(", ") : "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    page={seguridadPage}
                    totalPages={totalSeguridadPages}
                    onPrev={() => setSeguridadPage((prev) => Math.max(1, prev - 1))}
                    onNext={() => setSeguridadPage((prev) => Math.min(totalSeguridadPages, prev + 1))}
                  />
                </div>
              ) : null}

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Tabla de sucursales de retiro</h2>
              </div>
              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <p className="adm-config-subtitle">Estas sucursales se muestran al cliente para elegir donde retirar su canje.</p>
                <div className="adm-form-grid">
                  <input
                    className="adm-input"
                    placeholder="Nombre (ej: Sucursal Centro)"
                    value={nuevaSucursal.nombre}
                    onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, nombre: event.target.value }))}
                  />
                  <input
                    className="adm-input"
                    placeholder="Direccion (ej: Corrientes 1234)"
                    value={nuevaSucursal.direccion}
                    onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, direccion: event.target.value }))}
                  />
                </div>
                <div className="adm-form-grid">
                  <input
                    className="adm-input"
                    placeholder="Piso (opcional)"
                    value={nuevaSucursal.piso}
                    onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, piso: event.target.value }))}
                  />
                  <input
                    className="adm-input"
                    placeholder="Localidad"
                    value={nuevaSucursal.localidad}
                    onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, localidad: event.target.value }))}
                  />
                </div>
                <input
                  className="adm-input"
                  placeholder="Provincia"
                  value={nuevaSucursal.provincia}
                  onChange={(event) => setNuevaSucursal((prev) => ({ ...prev, provincia: event.target.value }))}
                />
                <button className="adm-btn-primary adm-btn-inline" onClick={crearSucursal} disabled={busy}>
                  {busy ? "Guardando..." : "Agregar sucursal"}
                </button>
              </div>

              <div className="admin-card" style={{ marginTop: "0.85rem" }}>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Direccion</th>
                        <th>Piso</th>
                        <th>Localidad</th>
                        <th>Provincia</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sucursalesPagina.length === 0 ? (
                        <tr>
                          <td colSpan={7}>
                            <div className="adm-empty">No hay sucursales registradas.</div>
                          </td>
                        </tr>
                      ) : null}
                      {sucursalesPagina.map((sucursal) => (
                        <Fragment key={sucursal.id}>
                          <tr>
                            <td>{sucursal.nombre}</td>
                            <td>{sucursal.direccion}</td>
                            <td>{sucursal.piso || "-"}</td>
                            <td>{sucursal.localidad}</td>
                            <td>{sucursal.provincia}</td>
                            <td>{sucursal.activo ? "Activa" : "Inactiva"}</td>
                            <td>
                              <div className="adm-user-actions">
                                <button className="adm-btn-link" onClick={() => iniciarEdicionSucursal(sucursal)}>
                                  Editar
                                </button>
                                <button
                                  className={sucursal.activo ? "adm-btn-danger" : "adm-btn-success"}
                                  onClick={() => toggleSucursalActiva(sucursal)}
                                >
                                  {sucursal.activo ? "Desactivar" : "Activar"}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {editSucursalId === sucursal.id ? (
                            <tr>
                              <td colSpan={7}>
                                <div className="adm-inline-points-box">
                                  <div className="adm-form-grid">
                                    <input
                                      className="adm-input"
                                      placeholder="Nombre"
                                      value={editSucursalDraft.nombre}
                                      onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, nombre: event.target.value }))}
                                    />
                                    <input
                                      className="adm-input"
                                      placeholder="Direccion"
                                      value={editSucursalDraft.direccion}
                                      onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, direccion: event.target.value }))}
                                    />
                                  </div>
                                  <div className="adm-form-grid" style={{ marginTop: "0.55rem" }}>
                                    <input
                                      className="adm-input"
                                      placeholder="Piso (opcional)"
                                      value={editSucursalDraft.piso}
                                      onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, piso: event.target.value }))}
                                    />
                                    <input
                                      className="adm-input"
                                      placeholder="Localidad"
                                      value={editSucursalDraft.localidad}
                                      onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, localidad: event.target.value }))}
                                    />
                                  </div>
                                  <input
                                    className="adm-input"
                                    style={{ marginTop: "0.55rem" }}
                                    placeholder="Provincia"
                                    value={editSucursalDraft.provincia}
                                    onChange={(event) => setEditSucursalDraft((prev) => ({ ...prev, provincia: event.target.value }))}
                                  />
                                  <div className="adm-inline-points-actions">
                                    <button className="adm-btn-primary adm-btn-inline" onClick={() => guardarEdicionSucursal(sucursal.id)} disabled={busy}>
                                      {busy ? "Guardando..." : "Guardar cambios"}
                                    </button>
                                    <button className="adm-btn-secondary adm-btn-inline" onClick={() => setEditSucursalId(null)}>
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={sucursalesPage}
                  totalPages={totalSucursalesPages}
                  onPrev={() => setSucursalesPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setSucursalesPage((prev) => Math.min(totalSucursalesPages, prev + 1))}
                />
              </div>
            </>
          ) : null}

          {tab === "usuarios" ? (
            <>
              <div className="admin-section-header">
                <h2 className="admin-section-title">Usuarios registrados</h2>
                <button className="adm-btn-link" onClick={() => setTab("crear")}>
                  Crear usuario
                </button>
              </div>

              <div className="adm-list-search">
                <input
                  className="adm-input"
                  placeholder="Buscar por nombre, email, DNI, rol o saldo..."
                  value={busquedaUsuarios}
                  onChange={(event) => setBusquedaUsuarios(event.target.value)}
                />
              </div>

              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Email</th>
                        <th>Rol</th>
                        <th>DNI</th>
                        <th>Saldo</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usuariosFiltrados.length === 0 ? (
                        <tr>
                          <td colSpan={7}>
                            <div className="adm-empty">No hay usuarios que coincidan con la busqueda.</div>
                          </td>
                        </tr>
                      ) : null}
                      {usuariosPagina.map((usuario) => (
                        <Fragment key={usuario.id}>
                          <tr>
                            <td>{usuario.nombre}</td>
                            <td>{usuario.email}</td>
                            <td>{formatRolLabel(usuario.rol)}</td>
                            <td>{usuario.dni || "-"}</td>
                            <td>{usuario.puntos_saldo}</td>
                            <td>
                              <span className={`adm-badge ${usuario.activo ? "adm-badge-active" : "adm-badge-inactive"}`}>
                                {usuario.activo ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td>
                              <div className="adm-user-actions">
                                <button className="adm-btn-link" onClick={() => iniciarEdicionUsuario(usuario)}>
                                  Editar
                                </button>
                                {usuario.rol === "cliente" ? (
                                  <button className="adm-btn-link" onClick={() => abrirAsignacion(usuario)}>
                                    Asignar puntos
                                  </button>
                                ) : null}
                                <button
                                  className={usuario.activo ? "adm-btn-danger" : "adm-btn-success"}
                                  onClick={() => toggleUsuarioActivo(usuario)}
                                >
                                  {usuario.activo ? "Desactivar" : "Activar"}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {editUsuarioId === usuario.id ? (
                            <tr>
                              <td colSpan={7}>
                                <div className="adm-inline-points-box">
                                  <p className="adm-inline-points-title">Editar usuario: {usuario.nombre}</p>
                                  <div className="adm-form-grid">
                                    <input
                                      className="adm-input"
                                      placeholder="Nombre"
                                      value={editUsuarioDraft.nombre}
                                      onChange={(event) => setEditUsuarioDraft((prev) => ({ ...prev, nombre: event.target.value }))}
                                    />
                                    <input
                                      className="adm-input"
                                      placeholder="Email"
                                      value={editUsuarioDraft.email}
                                      onChange={(event) => setEditUsuarioDraft((prev) => ({ ...prev, email: event.target.value }))}
                                    />
                                  </div>
                                  <div className="adm-form-grid" style={{ marginTop: "0.6rem" }}>
                                    <select
                                      className="adm-input"
                                      value={editUsuarioDraft.rol}
                                      onChange={(event) =>
                                        setEditUsuarioDraft((prev) => ({ ...prev, rol: event.target.value as UsuarioEditDraft["rol"] }))
                                      }
                                    >
                                      <option value="cliente">Cliente</option>
                                      <option value="vendedor">Vendedor</option>
                                      <option value="admin">Admin</option>
                                    </select>
                                    <input
                                      className="adm-input"
                                      placeholder="Teléfono (opcional)"
                                      value={editUsuarioDraft.telefono}
                                      onChange={(event) => setEditUsuarioDraft((prev) => ({ ...prev, telefono: event.target.value }))}
                                    />
                                  </div>
                                  {editUsuarioDraft.rol === "cliente" ? (
                                    <div className="adm-form-grid" style={{ marginTop: "0.6rem" }}>
                                      <input
                                        className="adm-input"
                                        placeholder="DNI"
                                        value={editUsuarioDraft.dni}
                                        onChange={(event) => setEditUsuarioDraft((prev) => ({ ...prev, dni: event.target.value }))}
                                      />
                                    </div>
                                  ) : null}
                                  <div className="adm-inline-points-actions">
                                    <button className="adm-btn-primary adm-btn-inline" disabled={busy} onClick={() => guardarEdicionUsuario(usuario.id)}>
                                      {busy ? "Guardando..." : "Guardar cambios"}
                                    </button>
                                    <button className="adm-btn-secondary adm-btn-inline" onClick={cancelarEdicionUsuario}>
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                          {asignacionUsuarioId === usuario.id ? (
                            <tr>
                              <td colSpan={7}>
                                <div className="adm-inline-points-box">
                                  <p className="adm-inline-points-title">Asignar puntos a {usuario.nombre}</p>
                                  <div className="adm-inline-points-grid">
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      className="adm-input"
                                      placeholder="Puntos a asignar"
                                      value={asignacionPuntos}
                                      onChange={(event) => setAsignacionPuntos(event.target.value)}
                                    />
                                    <input
                                      className="adm-input"
                                      placeholder="Descripcion (opcional)"
                                      value={asignacionDescripcion}
                                      onChange={(event) => setAsignacionDescripcion(event.target.value)}
                                    />
                                  </div>
                                  <div className="adm-inline-points-actions">
                                    <button className="adm-btn-primary adm-btn-inline" disabled={busy} onClick={asignarPuntosManual}>
                                      {busy ? "Asignando..." : "Confirmar asignacion"}
                                    </button>
                                    <button className="adm-btn-secondary adm-btn-inline" onClick={cancelarAsignacion}>
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={usuariosPage}
                  totalPages={totalUsuariosPages}
                  onPrev={() => setUsuariosPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setUsuariosPage((prev) => Math.min(totalUsuariosPages, prev + 1))}
                />
              </div>
            </>
          ) : null}

          {tab === "productos" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Nuevo producto" />

              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label className="adm-label">Nombre</label>
                    <input className="adm-input" value={nuevoProducto.nombre} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, nombre: event.target.value }))} />
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Categoria</label>
                    <select className="adm-input" value={nuevoProducto.categoria} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, categoria: event.target.value }))}>
                      <option value="">Sin categoria</option>
                      {categorias.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                    </select>
                  </div>
                </div>

                <div className="adm-field">
                  <label className="adm-label">Descripcion</label>
                  <textarea className="adm-input" value={nuevoProducto.descripcion} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, descripcion: event.target.value }))} />
                </div>

                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label className="adm-label">Puntos requeridos</label>
                    <input type="number" min={1} className="adm-input" value={nuevoProducto.puntos_requeridos ?? ""} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, puntos_requeridos: event.target.value ? Number(event.target.value) : null }))} />
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Puntos acumulables</label>
                    <input type="number" className="adm-input" value={nuevoProducto.puntos_acumulables ?? ""} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, puntos_acumulables: event.target.value ? Number(event.target.value) : null }))} />
                  </div>
                </div>

                <div
                  className="adm-upload adm-upload-dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => void manejarDropImagenesProducto(event, "nuevo")}
                >
                  <p className="adm-upload-drop-title">Arrastra fotos aquí (hasta 3)</p>
                  <p className="adm-upload-drop-sub">O selecciona desde tu dispositivo</p>
                  <label className="adm-btn-secondary adm-btn-inline" style={{ cursor: "pointer", width: "auto" }}>
                    Cargar imagen
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void subirImagenProducto(file, "nuevo");
                      }}
                    />
                  </label>
                </div>

                <div className="adm-inline-tip">Puedes cargar hasta 3 imágenes. La primera se usa como portada del catálogo.</div>
                {nuevoProducto.imagenes.length ? (
                  <div className="adm-product-images-grid">
                    {nuevoProducto.imagenes.map((url, index) => (
                      <div key={`${url}-${index}`} className="adm-product-image-card">
                        <img src={url} className="adm-product-image-thumb" alt={`Imagen ${index + 1}`} />
                        <div className="adm-product-image-row">
                          <span>Imagen {index + 1}</span>
                          <button type="button" className="adm-btn-danger" onClick={() => quitarImagenProducto("nuevo", index)}>
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <button className="adm-btn-primary" disabled={busy} onClick={crearProducto}>
                  {busy ? "Creando..." : "Crear producto"}
                </button>
              </div>

              <SectionTitle title="Productos existentes" />
              <div className="adm-list-search">
                <input
                  className="adm-input"
                  placeholder="Buscar producto por nombre, categoria, descripcion o puntos..."
                  value={busquedaProductos}
                  onChange={(event) => setBusquedaProductos(event.target.value)}
                />
              </div>
              <div className="admin-card">
                {productosFiltrados.length === 0 ? <div className="adm-empty">No hay productos que coincidan con la busqueda.</div> : null}
                {productosPagina.map((producto) => (
                  <div key={producto.id} className="adm-product-row">
                    {editId === producto.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div className="adm-form-grid">
                          <div className="adm-field">
                            <FieldLabel
                              text="Nombre"
                              tip="Nombre visible del producto en el catalogo. Conviene usar uno claro y corto."
                            />
                            <input
                              className="adm-input"
                              value={editDraft.nombre}
                              onChange={(event) => setEditDraft((prev) => ({ ...prev, nombre: event.target.value }))}
                              placeholder="Ej: Alfajor de Chocolate"
                            />
                          </div>
                          <div className="adm-field">
                            <FieldLabel
                              text="Categoria"
                              tip="Categoria del producto para filtros. Si no aplica, deja Sin categoria."
                            />
                            <select
                              className="adm-input"
                              value={editDraft.categoria}
                              onChange={(event) => setEditDraft((prev) => ({ ...prev, categoria: event.target.value }))}
                            >
                              <option value="">Sin categoria</option>
                              {categorias.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="adm-field">
                          <FieldLabel
                            text="Descripcion"
                            tip="Resumen del producto que se mostrara debajo del titulo. Puedes incluir sabor, relleno y cobertura."
                          />
                          <textarea
                            className="adm-input"
                            value={editDraft.descripcion}
                            onChange={(event) => setEditDraft((prev) => ({ ...prev, descripcion: event.target.value }))}
                            placeholder="Ej: Alfajor de fecula de mandioca con relleno de dulce de leche..."
                          />
                        </div>

                        <div className="adm-form-grid">
                          <div className="adm-field">
                            <FieldLabel
                              text="Puntos para canjear"
                              tip="Cantidad de puntos que el cliente necesita para canjear este producto."
                            />
                            <input
                              type="number"
                              min={1}
                              className="adm-input"
                              value={editDraft.puntos_requeridos ?? ""}
                              onChange={(event) => setEditDraft((prev) => ({ ...prev, puntos_requeridos: event.target.value ? Number(event.target.value) : null }))}
                            />
                          </div>
                          <div className="adm-field">
                            <FieldLabel
                              text="Puntos que suma al comprar"
                              tip="Puntos que gana el cliente cuando compra este producto."
                            />
                            <input
                              type="number"
                              min={0}
                              className="adm-input"
                              value={editDraft.puntos_acumulables ?? ""}
                              onChange={(event) =>
                                setEditDraft((prev) => ({ ...prev, puntos_acumulables: event.target.value ? Number(event.target.value) : null }))
                              }
                            />
                          </div>
                        </div>

                        <div
                          className="adm-upload adm-upload-dropzone"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => void manejarDropImagenesProducto(event, "edit")}
                        >
                          <p className="adm-upload-drop-title">Arrastra fotos aquí (hasta 3)</p>
                          <p className="adm-upload-drop-sub">También puedes reemplazar o agregar imágenes manualmente</p>
                          <label className="adm-btn-secondary adm-btn-inline" style={{ cursor: "pointer", width: "auto" }}>
                            Agregar imagen
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = "";
                                if (file) void subirImagenProducto(file, "edit");
                              }}
                            />
                          </label>
                        </div>

                        <div className="adm-inline-tip">Ordena tus imágenes quitando y volviendo a cargar. La primera se muestra como portada.</div>
                        {editDraft.imagenes.length ? (
                          <div className="adm-product-images-grid">
                            {editDraft.imagenes.map((url, index) => (
                              <div key={`${url}-${index}`} className="adm-product-image-card">
                                <img src={url} className="adm-product-image-thumb" alt={`Imagen ${index + 1}`} />
                                <div className="adm-product-image-row">
                                  <span>Imagen {index + 1}</span>
                                  <button type="button" className="adm-btn-danger" onClick={() => quitarImagenProducto("edit", index)}>
                                    Quitar
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button className="adm-btn-primary" style={{ flex: 2 }} onClick={() => saveEdit(producto.id)}>
                            Guardar cambios
                          </button>
                          <button className="adm-btn-secondary" onClick={() => setEditId(null)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="admin-producto-resumen">
                        <div>
                          <p className="admin-producto-title">{producto.nombre}</p>
                          <p className="admin-producto-sub">
                            {producto.categoria || "Sin categoria"} - {producto.puntos_requeridos} pts
                          </p>
                          <p className="admin-producto-sub">Imágenes: {producto.imagenes?.length ?? (producto.imagen_url ? 1 : 0)} / {MAX_PRODUCT_IMAGES}</p>
                        </div>
                        <div className="admin-producto-actions">
                          <button className="adm-btn-link" onClick={() => startEdit(producto)}>
                            Editar
                          </button>
                          <button className={producto.activo ? "adm-btn-danger" : "adm-btn-success"} onClick={() => toggleProductoActivo(producto)}>
                            {producto.activo ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <PaginationControls
                  page={productosPage}
                  totalPages={totalProductosPages}
                  onPrev={() => setProductosPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setProductosPage((prev) => Math.min(totalProductosPages, prev + 1))}
                />
              </div>
            </div>
          ) : null}

          {tab === "categorias" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Nueva categoria" />
              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <input className="adm-input" placeholder="Nombre" value={nuevaCategoria.nombre} onChange={(event) => setNuevaCategoria((prev) => ({ ...prev, nombre: event.target.value }))} />
                <button className="adm-btn-primary" disabled={busy} onClick={crearCategoria}>
                  {busy ? "Creando..." : "Crear categoria"}
                </button>
              </div>

              <SectionTitle title="Categorias existentes" />
              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Creada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoriasPagina.length === 0 ? (
                        <tr>
                          <td colSpan={2}>
                            <div className="adm-empty">No hay categorias para mostrar.</div>
                          </td>
                        </tr>
                      ) : null}
                      {categoriasPagina.map((categoria) => (
                        <tr key={categoria.id}>
                          <td>{categoria.nombre}</td>
                          <td>{formatDate(categoria.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={categoriasPage}
                  totalPages={totalCategoriasPages}
                  onPrev={() => setCategoriasPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setCategoriasPage((prev) => Math.min(totalCategoriasPages, prev + 1))}
                />
              </div>
            </div>
          ) : null}

          {tab === "transacciones" ? (
            <>
              <SectionTitle title="Historial de movimientos" />
              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Usuario</th>
                        <th>Tipo</th>
                        <th>Puntos</th>
                        <th>Descripcion</th>
                        <th>Admin</th>
                        <th>Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transaccionesPagina.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <div className="adm-empty">No hay movimientos para mostrar.</div>
                          </td>
                        </tr>
                      ) : null}
                      {transaccionesPagina.map((movimiento) => (
                        <tr key={movimiento.id}>
                          <td>{movimiento.usuario_nombre}</td>
                          <td>{formatMovimientoTipo(movimiento.tipo)}</td>
                          <td className={movimiento.puntos >= 0 ? "adm-pts-pos" : "adm-pts-neg"}>
                            {movimiento.puntos >= 0 ? "+" : ""}
                            {movimiento.puntos}
                          </td>
                          <td>{movimiento.descripcion || "-"}</td>
                          <td>{movimiento.admin_nombre || "-"}</td>
                          <td>{formatDate(movimiento.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={transaccionesPage}
                  totalPages={totalTransaccionesPages}
                  onPrev={() => setTransaccionesPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setTransaccionesPage((prev) => Math.min(totalTransaccionesPages, prev + 1))}
                />
              </div>
            </>
          ) : null}

          {tab === "canjes" ? (
            <>
              <SectionTitle title="Gestion de canjes" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.8rem", marginBottom: "1rem" }}>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#7A5A3C" }}>
                  Reclama canjes por codigo sin salir del panel admin.
                </p>
                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <input
                    className="adm-input"
                    placeholder="Ingresa codigo de canje"
                    value={codigoCanjeAdmin}
                    onChange={(event) => {
                      setCodigoCanjeAdmin(event.target.value.toUpperCase());
                      setCanjeCodigoAdmin(null);
                      setCanjeCodigoAdminErr("");
                      setCanjeCodigoAdminOk("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void buscarCanjeCodigoAdmin();
                      }
                    }}
                    maxLength={9}
                    style={{ textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, flex: "1 1 280px" }}
                  />
                  <button
                    className="adm-btn-primary adm-btn-inline"
                    onClick={() => void buscarCanjeCodigoAdmin()}
                    disabled={buscandoCanjeAdmin || codigoCanjeAdmin.trim().length < 3}
                  >
                    {buscandoCanjeAdmin ? "Buscando..." : "Buscar"}
                  </button>
                </div>

                {canjeCodigoAdminErr ? <div className="adm-msg-err">{canjeCodigoAdminErr}</div> : null}
                {canjeCodigoAdminOk ? <div className="adm-msg-ok">{canjeCodigoAdminOk}</div> : null}

                {canjeCodigoAdmin ? (
                  <div style={{ background: "#FFF8F0", border: "1px solid rgba(180,84,20,0.24)", borderRadius: "12px", padding: "0.85rem" }}>
                    <p style={{ margin: "0 0 0.45rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8B5A30" }}>
                      Detalle del canje
                    </p>
                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <p style={{ margin: 0, fontSize: "0.9rem" }}><strong>Producto principal:</strong> {canjeCodigoAdmin.producto_nombre}</p>
                      {canjeCodigoAdmin.items?.length ? (
                        <div style={{ color: "#8B5A30", fontSize: "0.78rem" }}>
                          <p style={{ margin: "0 0 0.18rem", fontWeight: 700 }}>
                            Productos ({canjeCodigoAdmin.total_unidades ?? canjeCodigoAdmin.items.reduce((acc, item) => acc + item.cantidad, 0)} unidades):
                          </p>
                          {canjeCodigoAdmin.items.map((item) => (
                            <p key={`${item.producto_id}-${item.cantidad}`} style={{ margin: "0.1rem 0" }}>
                              - {item.producto_nombre} x{item.cantidad}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <p style={{ margin: 0, fontSize: "0.9rem" }}><strong>Cliente:</strong> {canjeCodigoAdmin.cliente_nombre} - DNI {canjeCodigoAdmin.cliente_dni}</p>
                      <p style={{ margin: 0, fontSize: "0.9rem" }}><strong>Puntos:</strong> {canjeCodigoAdmin.puntos_usados} pts</p>
                      {canjeCodigoAdmin.sucursal_nombre ? (
                        <p style={{ margin: 0, fontSize: "0.9rem" }}>
                          <strong>Sucursal:</strong> {canjeCodigoAdmin.sucursal_nombre} - {canjeCodigoAdmin.sucursal_direccion}
                          {canjeCodigoAdmin.sucursal_piso ? `, Piso ${canjeCodigoAdmin.sucursal_piso}` : ""}
                          {canjeCodigoAdmin.sucursal_localidad ? `, ${canjeCodigoAdmin.sucursal_localidad}` : ""}
                          {canjeCodigoAdmin.sucursal_provincia ? `, ${canjeCodigoAdmin.sucursal_provincia}` : ""}
                        </p>
                      ) : null}
                      <p style={{ margin: 0, fontSize: "0.9rem" }}>
                        <strong>Estado:</strong>{" "}
                        <span style={{ color: canjeCodigoAdmin.estado === "pendiente" ? "#D4621A" : canjeCodigoAdmin.estado === "entregado" ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                          {canjeCodigoAdmin.estado.toUpperCase()}
                        </span>
                      </p>
                    </div>

                    {!canjeCodigoAdminFinalizado ? (
                      <div style={{ display: "flex", gap: "0.45rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                        <button
                          className="adm-btn-primary adm-btn-inline"
                          style={{ background: "#16a34a", minWidth: "130px" }}
                          disabled={procesandoCanjeAdmin}
                          onClick={() => void procesarCanjeCodigoAdmin("entregado")}
                        >
                          Entregado
                        </button>
                        <button
                          className="adm-btn-secondary"
                          style={{ flex: "0 0 auto", minWidth: "130px" }}
                          disabled={procesandoCanjeAdmin}
                          onClick={() => void procesarCanjeCodigoAdmin("no_disponible")}
                        >
                          No disponible
                        </button>
                        <button
                          className="adm-btn-secondary"
                          style={{ flex: "0 0 auto", minWidth: "130px", color: "#dc2626", borderColor: "#dc2626" }}
                          disabled={procesandoCanjeAdmin}
                          onClick={() => void procesarCanjeCodigoAdmin("cancelado")}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <p style={{ margin: "0.8rem 0 0", fontSize: "0.82rem", color: "#7A5A3C", fontWeight: 600 }}>
                        Este canje ya no puede modificarse.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Producto</th>
                        <th>Sucursal</th>
                        <th>Codigo</th>
                        <th>Puntos</th>
                        <th>Estado</th>
                        <th>Fecha</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {canjesPagina.length === 0 ? (
                        <tr>
                          <td colSpan={8}>
                            <div className="adm-empty">No hay canjes para mostrar.</div>
                          </td>
                        </tr>
                      ) : null}
                      {canjesPagina.map((canje) => (
                        <tr key={canje.id}>
                          <td>
                            {canje.cliente_nombre}
                            <br />
                            <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{canje.cliente_dni}</span>
                          </td>
                          <td>
                            <div style={{ display: "grid", gap: "0.2rem" }}>
                              <span>{canje.producto_nombre}</span>
                              {((canje.total_items ?? 0) > 1 || (canje.total_unidades ?? 0) > 1) ? (
                                <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>
                                  {canje.productos_detalle}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            {canje.sucursal_nombre ? (
                              <>
                                {canje.sucursal_nombre}
                                <br />
                                <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>
                                  {canje.sucursal_direccion}
                                  {canje.sucursal_piso ? `, Piso ${canje.sucursal_piso}` : ""}
                                  {canje.sucursal_localidad ? `, ${canje.sucursal_localidad}` : ""}
                                  {canje.sucursal_provincia ? `, ${canje.sucursal_provincia}` : ""}
                                </span>
                              </>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td><span className="adm-code-chip">{getCanjeCode(canje)}</span></td>
                          <td>{canje.puntos_usados}</td>
                          <td>{formatEstadoCanje(canje.estado)}</td>
                          <td>{formatDate(canje.created_at)}</td>
                          <td>
                            {canje.estado === "pendiente" ? (
                              <div style={{ display: "flex", gap: "0.4rem" }}>
                                <button className="adm-btn-success" style={{ padding: "0.35rem 0.55rem", fontSize: "0.75rem" }} onClick={() => prepararConfirmacion(canje, "entregado")}>
                                  Entregar
                                </button>
                                <button className="adm-btn-danger" style={{ padding: "0.35rem 0.55rem", fontSize: "0.75rem" }} onClick={() => prepararConfirmacion(canje, "cancelado")}>
                                  Anular
                                </button>
                              </div>
                            ) : (
                              <span>-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={canjesPage}
                  totalPages={totalCanjesPages}
                  onPrev={() => setCanjesPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setCanjesPage((prev) => Math.min(totalCanjesPages, prev + 1))}
                />
              </div>
            </>
          ) : null}

          {tab === "codigos" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Nuevo codigo promocional" />
              <div className="admin-card admin-card-padded adm-code-guide">
                <p className="adm-code-guide-title">Guia para crear codigos</p>
                <div className="adm-code-guide-grid">
                  <div>
                    <p className="adm-code-guide-label">Codigo promocional</p>
                    <p className="adm-code-guide-text">Nombre unico en mayusculas y sin espacios. Ejemplo: BIENVENIDA2026.</p>
                  </div>
                  <div>
                    <p className="adm-code-guide-label">Puntos que entrega</p>
                    <p className="adm-code-guide-text">Cantidad de puntos que suma cada canje del codigo.</p>
                  </div>
                  <div>
                    <p className="adm-code-guide-label">Usos maximos</p>
                    <p className="adm-code-guide-text">0 significa usos ilimitados. Si pones 1 o mas, se limita a ese total.</p>
                  </div>
                  <div>
                    <p className="adm-code-guide-label">Fecha de expiracion</p>
                    <p className="adm-code-guide-text">Opcional. Si la dejas vacia, el codigo no vence por fecha.</p>
                  </div>
                </div>
              </div>
              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label className="adm-label">Codigo promocional</label>
                    <input className="adm-input" placeholder="Ej: BIENVENIDA2026" value={nuevoCodigo.codigo} onChange={(event) => setNuevoCodigo((prev) => ({ ...prev, codigo: event.target.value.toUpperCase() }))} />
                    <p className="adm-field-help">Solo letras y numeros, sin espacios.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Puntos que entrega</label>
                    <input type="number" min={1} className="adm-input" placeholder="Ej: 500" value={nuevoCodigo.puntos_valor ?? ""} onChange={(event) => setNuevoCodigo((prev) => ({ ...prev, puntos_valor: event.target.value ? Number(event.target.value) : null }))} />
                    <p className="adm-field-help">Valor de puntos que recibe el cliente al canjear.</p>
                  </div>
                </div>
                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label className="adm-label">Usos maximos</label>
                    <input type="number" min={0} className="adm-input" placeholder="Ej: 1" value={nuevoCodigo.usos_maximos ?? ""} onChange={(event) => setNuevoCodigo((prev) => ({ ...prev, usos_maximos: event.target.value ? Number(event.target.value) : null }))} />
                    <p className="adm-field-help">0 = ilimitado. 1 o mas = limite total de usos.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Fecha de expiracion</label>
                    <input type="datetime-local" className="adm-input" value={nuevoCodigo.fecha_expiracion} onChange={(event) => setNuevoCodigo((prev) => ({ ...prev, fecha_expiracion: event.target.value }))} />
                    <p className="adm-field-help">Opcional. Si no completas, el codigo queda sin vencimiento.</p>
                  </div>
                </div>
                <button className="adm-btn-primary" disabled={busy} onClick={crearCodigo}>
                  {busy ? "Creando..." : "Crear codigo"}
                </button>
              </div>

              <SectionTitle title="Codigos existentes" />
              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Codigo</th>
                        <th>Puntos</th>
                        <th>Usos</th>
                        <th>Expira</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codigosPagina.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <div className="adm-empty">No hay codigos para mostrar.</div>
                          </td>
                        </tr>
                      ) : null}
                      {codigosPagina.map((codigo) => (
                        <tr key={codigo.id}>
                          <td><span className="adm-code-chip">{codigo.codigo}</span></td>
                          <td>{codigo.puntos_valor}</td>
                          <td>{codigo.usos_actuales}/{codigo.usos_maximos}</td>
                          <td>{codigo.fecha_expiracion ? formatDate(codigo.fecha_expiracion) : "Sin vencimiento"}</td>
                          <td>{codigo.activo ? "Activo" : "Inactivo"}</td>
                          <td>
                            <button className={codigo.activo ? "adm-btn-danger" : "adm-btn-success"} onClick={() => toggleCodigo(codigo)}>
                              {codigo.activo ? "Desactivar" : "Activar"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={codigosPage}
                  totalPages={totalCodigosPages}
                  onPrev={() => setCodigosPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setCodigosPage((prev) => Math.min(totalCodigosPages, prev + 1))}
                />
              </div>
            </div>
          ) : null}

          {tab === "crear" ? (
            <>
              <SectionTitle title="Crear usuario" />
              <div className="admin-card admin-card-padded" style={{ maxWidth: "520px", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <input className="adm-input" placeholder="Nombre" value={nuevoUsuario.nombre} onChange={(event) => setNuevoUsuario((prev) => ({ ...prev, nombre: event.target.value }))} />
                <input className="adm-input" placeholder="Email" value={nuevoUsuario.email} onChange={(event) => setNuevoUsuario((prev) => ({ ...prev, email: event.target.value }))} />
                <input type="password" className="adm-input" placeholder="Contrasena" value={nuevoUsuario.password} onChange={(event) => setNuevoUsuario((prev) => ({ ...prev, password: event.target.value }))} />
                <select
                  className="adm-input"
                  value={nuevoUsuario.rol}
                  onChange={(event) =>
                    setNuevoUsuario((prev) => ({ ...prev, rol: event.target.value as "cliente" | "vendedor" | "admin" }))
                  }
                >
                  <option value="vendedor">Vendedor</option>
                  <option value="cliente">Cliente</option>
                  <option value="admin">Admin</option>
                </select>
                {nuevoUsuario.rol === "cliente" ? (
                  <input className="adm-input" placeholder="DNI" value={nuevoUsuario.dni} onChange={(event) => setNuevoUsuario((prev) => ({ ...prev, dni: event.target.value }))} />
                ) : null}
                <button className="adm-btn-primary" disabled={busy} onClick={crearUsuario}>
                  {busy ? "Creando..." : "Crear usuario"}
                </button>
              </div>
            </>
          ) : null}

          {tab === "sobre-nosotros" ? (
            <>
              <SectionTitle title="Quienes Somos" />
              <div className="adm-page-editor-grid">
                <div className="adm-page-editor-col">
                  <div className="adm-notepad">
                    <div className="adm-notepad-header">
                      <p className="adm-notepad-header-title">Editor Markdown</p>
                      <span className="adm-notepad-md-badge">MD</span>
                    </div>
                    <div className="adm-notepad-body">
                      <p className="adm-md-hint">
                        Guía rápida Markdown: <code>#</code> título grande, <code>##</code> subtítulo, <code>-</code> listas,
                        <code> **texto** </code> negrita y <code>[texto](https://url)</code> para enlaces.
                      </p>
                      <input className="adm-notepad-title-input" value={sobreDraft.titulo} onChange={(event) => setSobreDraft((prev) => ({ ...prev, titulo: event.target.value }))} placeholder="Titulo" />
                      <textarea className="adm-notepad-textarea adm-page-textarea" value={sobreDraft.contenido} onChange={(event) => setSobreDraft((prev) => ({ ...prev, contenido: event.target.value }))} placeholder="Contenido en markdown" />
                      <div className="adm-page-images-panel">
                        <div className="adm-page-images-head">
                          <p className="adm-page-images-title">Fotos debajo ({sobreImagenes.length}/{MAX_STATIC_PAGE_IMAGES})</p>
                          <label className={`adm-btn-secondary adm-page-images-upload ${sobreImagenes.length >= MAX_STATIC_PAGE_IMAGES ? "is-disabled" : ""}`}>
                            Agregar foto
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              disabled={sobreImagenes.length >= MAX_STATIC_PAGE_IMAGES}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = "";
                                if (file) void subirImagenPagina("sobre-nosotros", file);
                              }}
                            />
                          </label>
                        </div>
                        {sobreImagenes.length ? (
                          <div className="adm-page-images-grid">
                            {sobreImagenes.map((url, index) => (
                              <div className="adm-page-image-card" key={`${url}-${index}`}>
                                <img src={url} alt={`Foto ${index + 1}`} className="adm-page-image-thumb" />
                                <button type="button" className="adm-page-image-remove" onClick={() => quitarImagenPagina("sobre-nosotros", index)}>
                                  Quitar
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="adm-page-images-empty">No hay fotos cargadas.</p>
                        )}
                      </div>
                    </div>
                    <div className="adm-notepad-footer">
                      <span className="adm-notepad-ok">{sobreDraft.okMsg}</span>
                      <span className="adm-notepad-err">{sobreDraft.errMsg}</span>
                      <button className="adm-notepad-save" onClick={() => guardarPagina("sobre-nosotros")}>
                        Guardar cambios
                      </button>
                    </div>
                  </div>
                </div>
                <div className="adm-page-editor-col">
                  <div className="adm-notepad adm-notepad-preview">
                    <div className="adm-notepad-header">
                      <p className="adm-notepad-header-title">Preview</p>
                      <span className="adm-notepad-md-badge">LIVE</span>
                    </div>
                    <div className="adm-md-preview" dangerouslySetInnerHTML={{ __html: sobreHtml }} />
                    <StaticPageGallery images={sobreImagenes} className="adm-page-preview-gallery" />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {tab === "terminos" ? (
            <>
              <SectionTitle title="Terminos y Condiciones" />
              <div className="adm-page-editor-grid">
                <div className="adm-page-editor-col">
                  <div className="adm-notepad">
                    <div className="adm-notepad-header">
                      <p className="adm-notepad-header-title">Editor Markdown</p>
                      <span className="adm-notepad-md-badge">MD</span>
                    </div>
                    <div className="adm-notepad-body">
                      <p className="adm-md-hint">
                        Guía rápida Markdown: <code>#</code> título grande, <code>##</code> subtítulo, <code>-</code> listas,
                        <code> **texto** </code> negrita y <code>[texto](https://url)</code> para enlaces.
                      </p>
                      <input className="adm-notepad-title-input" value={terminosDraft.titulo} onChange={(event) => setTerminosDraft((prev) => ({ ...prev, titulo: event.target.value }))} placeholder="Titulo" />
                      <textarea className="adm-notepad-textarea adm-page-textarea" value={terminosDraft.contenido} onChange={(event) => setTerminosDraft((prev) => ({ ...prev, contenido: event.target.value }))} placeholder="Contenido en markdown" />
                      <div className="adm-page-images-panel">
                        <div className="adm-page-images-head">
                          <p className="adm-page-images-title">Fotos debajo ({terminosImagenes.length}/{MAX_STATIC_PAGE_IMAGES})</p>
                          <label className={`adm-btn-secondary adm-page-images-upload ${terminosImagenes.length >= MAX_STATIC_PAGE_IMAGES ? "is-disabled" : ""}`}>
                            Agregar foto
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              disabled={terminosImagenes.length >= MAX_STATIC_PAGE_IMAGES}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = "";
                                if (file) void subirImagenPagina("terminos", file);
                              }}
                            />
                          </label>
                        </div>
                        {terminosImagenes.length ? (
                          <div className="adm-page-images-grid">
                            {terminosImagenes.map((url, index) => (
                              <div className="adm-page-image-card" key={`${url}-${index}`}>
                                <img src={url} alt={`Foto ${index + 1}`} className="adm-page-image-thumb" />
                                <button type="button" className="adm-page-image-remove" onClick={() => quitarImagenPagina("terminos", index)}>
                                  Quitar
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="adm-page-images-empty">No hay fotos cargadas.</p>
                        )}
                      </div>
                    </div>
                    <div className="adm-notepad-footer">
                      <span className="adm-notepad-ok">{terminosDraft.okMsg}</span>
                      <span className="adm-notepad-err">{terminosDraft.errMsg}</span>
                      <button className="adm-notepad-save" onClick={() => guardarPagina("terminos")}>
                        Guardar cambios
                      </button>
                    </div>
                  </div>
                </div>
                <div className="adm-page-editor-col">
                  <div className="adm-notepad adm-notepad-preview">
                    <div className="adm-notepad-header">
                      <p className="adm-notepad-header-title">Preview</p>
                      <span className="adm-notepad-md-badge">LIVE</span>
                    </div>
                    <div className="adm-md-preview" dangerouslySetInnerHTML={{ __html: terminosHtml }} />
                    <StaticPageGallery images={terminosImagenes} className="adm-page-preview-gallery" />
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </main>

      {/* MODAL DE CONFIRMACION */}
      {confirmacion && (
        <div className="adm-modal-overlay">
          <div className="adm-modal">
            <div className={`adm-modal-icon ${confirmacion.estado === 'entregado' ? 'success' : 'warning'}`}>
              {confirmacion.estado === 'entregado' ? 'OK' : '!'}
            </div>
            <h3 className="adm-modal-title">
              {confirmacion.estado === 'entregado' ? '¿Confirmar entrega?' : '¿Anular este canje?'}
            </h3>
            <p className="adm-modal-desc">
              {confirmacion.estado === 'entregado' 
                ? `Estás por marcar como ENTREGADO el canje de "${confirmacion.producto}" para ${confirmacion.cliente}.`
                : `Se anulará el canje de "${confirmacion.producto}" para ${confirmacion.cliente}. Los puntos se devolverán automáticamente al saldo del usuario.`
              }
            </p>
            <div className="adm-modal-actions">
              <button className="adm-btn-secondary" onClick={() => setConfirmacion(null)} disabled={busy}>
                Cancelar
              </button>
              <button 
                className={confirmacion.estado === 'entregado' ? 'adm-btn-primary' : 'adm-btn-primary'} 
                style={{ background: confirmacion.estado === 'entregado' ? '#16A34A' : '#6B3E26' }}
                onClick={() => actualizarEstadoCanje(confirmacion.id, confirmacion.estado)}
                disabled={busy}
              >
                {busy ? 'Procesando...' : confirmacion.estado === 'entregado' ? 'Confirmar entrega' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

