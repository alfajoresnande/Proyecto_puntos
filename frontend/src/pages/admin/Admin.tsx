import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useToast } from "../../components/ToastProvider";
import { apiUrl, mediaUrl } from "../../lib/apiBase";
import { getCsrfToken } from "../../lib/csrf";
import { formatBuenosAiresDate, formatBuenosAiresDateTime, getBuenosAiresDateStamp } from "../../lib/dateTime";
import {
  getLocalSaleQuickProductImage,
  getLocalSaleQuickProductSubtitle,
} from "../../lib/localSaleQuickProducts";
import { renderSafeMarkdown, stripPageImages } from "../../lib/pageContent";
import { calculatePointsByAmount } from "../../lib/points";
import { AdminVentasView, type AdminVentasViewKey } from "./views/AdminVentasView";
import { AreaExplanation } from "./components/AreaExplanation";
import { useAuthStore } from "../../store/authStore";
import type { Producto, Rol, TipoCliente } from "../../types";
import { AdminLayoutTimeline } from "./AdminLayoutTimeline";
import { AdminLayoutDonde } from "./AdminLayoutDonde";

type AdminTab =
  | "inicio"
  | "usuarios"
  | "cumpleanos"
  | "personas-app"
  | "productos"
  | "productos-crear"
  | "productos-edicion"
  | "productos-sabores"
  | "inventario"
  | "postulaciones"
  | "ordenes"
  | "caja"
  | "gastos"
  | "proveedores"
  | "cobros"
  | "descuentos"
  | "categorias"
  | "transacciones"
  | "canjes"
  | "codigos"
  | "crear"
  | "terminos"
  | "politica-privacidad"
  | "arrepentimiento"
  | "layout-timeline"
  | "layout-donde";

function passwordValidationErrors(value: string): string[] {
  const errors: string[] = [];
  if (value.length < 8) errors.push("Minimo 8 caracteres");
  if (!/[^A-Za-z0-9]/.test(value)) errors.push("Al menos 1 caracter especial");
  if (!/\d/.test(value)) errors.push("Al menos 1 numero");
  return errors;
}

const ADMIN_TABS: AdminTab[] = [
  "inicio",
  "usuarios",
  "cumpleanos",
  "personas-app",
  "productos",
  "productos-crear",
  "productos-edicion",
  "productos-sabores",
  "inventario",
  "postulaciones",
  "ordenes",
  "caja",
  "gastos",
  "proveedores",
  "cobros",
  "descuentos",
  "categorias",
  "transacciones",
  "canjes",
  "codigos",
  "crear",
  "terminos",
  "politica-privacidad",
  "arrepentimiento",
  "layout-timeline",
  "layout-donde",
];

const ADMIN_AREA_EXPLANATIONS: Record<AdminTab, string[]> = {
  inicio: [
    "Aca ves un resumen rapido del sistema: clientes, productos, canjes pendientes y ultimos movimientos.",
    "Tambien podes ajustar reglas generales del programa, como vencimientos de canjes, reservas en efectivo y datos que aparecen en comprobantes.",
    "Si necesitas cambiar sucursales, respaldos o revisar seguridad, desde esta area tenes los accesos principales.",
  ],
  usuarios: [
    "Aca se revisan los usuarios registrados y se pueden editar datos importantes como rol, perfil comercial, puntos y estado de la cuenta.",
    "El perfil comercial sirve para que un cliente vea precios distintos en la tienda, por ejemplo mayorista o empleado, segun los descuentos configurados.",
    "Usa esta area cuando necesites corregir datos de una cuenta, activar o bloquear usuarios, o revisar quien tiene permisos de vendedor o administrador.",
  ],
  cumpleanos: [
    "Aca ves los proximos cumpleaños segun la fecha de nacimiento guardada en cada usuario.",
    "Puedes elegir cuántos meses hacia adelante quieres revisar y el sistema calcula la próxima fecha y cuántos días faltan.",
    "Si hoy cumple alguien, la vista muestra un aviso y te deja abrir WhatsApp de la empresa con el mensaje ya preparado.",
  ],
  "personas-app": [
    "Aca ves quienes estan navegando la app ahora mismo, separados entre usuarios no registrados y clientes con sesion iniciada.",
    "Cada dispositivo genera una sesion y el sistema renueva el registro cada 30 minutos mientras la persona sigue navegando.",
    "El staff no aparece en esta vista: solo se cuentan clientes o personas que recorren la parte publica o cliente de la app.",
  ],
  productos: [
    "Aca se ve el listado general de productos cargados, con precio, categoria, tipo, stock e imagenes.",
    "Usa esta vista para revisar rapidamente que productos estan activos, buscar por nombre o categoria y entrar a editar cuando haga falta.",
    "Si solo queres pausar un producto, conviene desactivarlo en vez de borrarlo para conservar ventas, stock e historial.",
  ],
  "productos-crear": [
    "Aca se cargan productos nuevos para la tienda online, canjes y venta local.",
    "En esta vista se define nombre, categoria, precio, puntos, imagenes, retiro, envio, stock y si el producto sera una caja configurable por sabores.",
    "Si el producto es una caja configurable, primero conviene revisar que los sabores existan en Sabores de cajas.",
  ],
  "productos-edicion": [
    "Aca se editan productos que ya existen sin mezclarlo con la carga de productos nuevos.",
    "Buscá el producto, tocá Editar y cambiá precio, puntos, categoria, imagenes, stock o configuracion de caja.",
    "Los cambios se reflejan en tienda, ventas locales, canjes y reportes.",
  ],
  "productos-sabores": [
    "Aca se cargan los sabores que despues se usan en las cajas configurables.",
    "Cada sabor puede tener stock por sucursal. Cuando se vende una caja personalizada, el sistema descuenta los sabores elegidos.",
    "Conviene mantener esta lista ordenada y desactivar sabores que ya no se venden, en vez de eliminarlos del historial.",
  ],
  inventario: [
    "Aca se controla el stock disponible por sucursal y se revisan los movimientos de entrada, salida y reserva.",
    "El stock compartido se usa tanto para ventas web como para ventas locales, asi se evita vender mas unidades de las disponibles.",
    "El historial ayuda a entender por que cambio el stock: ventas, cancelaciones, ajustes manuales o movimientos internos.",
  ],
  postulaciones: [
    "Aca se revisan los CV enviados desde el formulario publico del home.",
    "La vista muestra datos de contacto, mensaje y el archivo adjunto para descargar cuando haga falta.",
    "Los archivos quedan guardados fuera de la carpeta publica y solo se descargan desde el panel.",
  ],
  ordenes: [
    "Aca se gestionan pedidos web, ventas locales y reportes de ventas. Cada vista tiene su propia explicacion.",
  ],
  caja: [
    "Cada dia el sistema prepara la caja de la sucursal automaticamente, desde las 00:00 hasta las 23:59 en horario Buenos Aires.",
    "Todo lo que se cobre o pague en el local durante ese dia queda anotado en esa caja. Asi al final del dia se puede revisar cuanto entro, cuanto salio y por que medio se movio el dinero.",
    "Las ventas locales suman como ingresos y los gastos cargados restan como egresos. Las ventas web se ven en pedidos y reportes, pero esta caja se usa para controlar la plata del local.",
    "Los movimientos se separan por medio de pago: efectivo, transferencia, tarjeta, QR u otro. El efectivo del dia se calcula con el efectivo inicial mas las ventas en efectivo, menos los gastos en efectivo.",
    "Si una venta se cancela antes de entregar, el sistema actualiza la orden y devuelve stock segun corresponda. Si hubo pago aprobado, la devolucion del dinero se coordina por mensaje con el cliente para dejar registro.",
  ],
  gastos: [
    "Aca se registran pagos que salen de la caja, como compras a proveedores, servicios o pagos a terceros.",
    "Cada gasto queda asociado a una sucursal, a la caja del dia y a un medio de pago para que el cierre reste correctamente.",
    "Si el gasto fue para alguien que no esta en proveedores, usa persona o comercio manual para dejarlo identificado.",
  ],
  proveedores: [
    "Aca se cargan los proveedores habituales para elegirlos rapido cuando registres un gasto.",
    "Tener proveedores ordenados ayuda a revisar a quien se le pago, cuanto se gasto y de que tipo fueron los egresos.",
    "Si un proveedor deja de usarse, conviene desactivarlo en vez de perder el historial.",
  ],
  cobros: [
    "Aca se cargan los porcentajes que descuenta cada medio de cobro, por ejemplo Mercado Pago, QR, tarjeta o link de pago.",
    "Cuando una venta usa un medio con comision, los reportes pueden mostrar bruto, comision y neto real cobrado.",
    "Efectivo normalmente queda en 0%, porque no tiene descuento de plataforma.",
  ],
  descuentos: [
    "Aca se configuran descuentos por tipo de cliente y categoria, por ejemplo mayoristas con descuento en alfajores o empleados con otro descuento.",
    "Estos descuentos afectan el precio que ve el cliente al iniciar sesion y tambien se usan en ventas locales si se elige ese cliente.",
    "La campana web global sirve para promociones generales tipo Hot Sale o Black Friday, y se aplica solo a compras web.",
  ],
  categorias: [
    "Aca se organizan las lineas de producto, como alfajores, cajas, bebidas o confites.",
    "Las categorias ayudan a filtrar la tienda, ordenar el catalogo y aplicar descuentos por tipo de cliente.",
    "Antes de crear muchos productos, conviene tener bien definidas las categorias principales.",
    "Si una categoria va en Home, conviene subir un icono cuadrado y simple para que el circulo celeste del frontend la muestre prolija.",
  ],
  transacciones: [
    "Aca se ve el historial de movimientos de puntos de los clientes.",
    "Sirve para revisar puntos sumados, puntos usados, ajustes manuales, canjes y referencias.",
    "Cuando haya dudas con el saldo de un cliente, esta area muestra de donde viene cada movimiento.",
  ],
  canjes: [
    "Aca se gestionan los canjes de puntos que hicieron los clientes.",
    "Desde esta vista se revisa si el canje esta pendiente, preparado, entregado, cancelado o expirado.",
    "Si un canje se cancela o expira, el sistema puede devolver stock y puntos segun corresponda.",
  ],
  codigos: [
    "Aca se crean codigos promocionales de puntos para campanas, sorteos o acciones especiales.",
    "Cada codigo puede tener limite de usos, fecha de vencimiento y cantidad de puntos a acreditar.",
    "El listado permite ver cuales siguen activos y controlar si ya se usaron.",
  ],
  crear: [
    "Aca se crean usuarios manualmente cuando no queres que la persona pase por el registro normal.",
    "Podes crear clientes web, vendedores o administradores. Si es cliente, tambien podes elegir si sera cliente comun, mayorista o empleado.",
    "Los permisos deben asignarse con cuidado: vendedor puede operar ventas locales y admin puede gestionar el panel.",
  ],
  terminos: [
    "Aca se editan los Terminos y Condiciones que ven los clientes.",
    "Conviene mantener esta pagina clara para explicar canjes, pedidos, retiros, vencimientos y condiciones de uso.",
    "El editor permite guardar texto e imagenes sin tocar codigo.",
  ],
  "politica-privacidad": [
    "Aca se edita la Politica de Privacidad publica.",
    "Conviene mantener esta pagina alineada con los datos que la app realmente recopila y con los canales de contacto vigentes.",
    "El editor permite guardar texto e imagenes sin tocar codigo.",
  ],
  arrepentimiento: [
    "Aca se listan las solicitudes del boton de arrepentimiento.",
    "Puedes buscar por codigo de tramite, numero de orden, nombre, email o telefono.",
    "La vista se actualiza periodicamente para ayudarte a seguir ingresos nuevos.",
  ],
  "layout-timeline": [
    "Aca se editan los eventos de la Línea de Tiempo de la página principal.",
    "Podes subir una foto, agregar textos, insignias, elegir el orden en el que se muestran y decidir cuáles están activos o pausados.",
  ],
  "layout-donde": [
    "Aca se edita la seccion Dónde encontrarnos del inicio.",
    "Podes subir las fotos que se ven y poner a qué link dirigen cuando alguien hace clic.",
  ],
};

const CATEGORY_IMAGE_GUIDE_ITEMS = [
  {
    label: "Tamano recomendado",
    text: "1024 x 1024 px. Siempre cuadrada para que el recorte circular en Home quede centrado y limpio.",
  },
  {
    label: "Formato ideal",
    text: "PNG o WebP con fondo transparente. JPG sirve, pero para el estilo icono premium conviene transparente.",
  },
  {
    label: "Estilo visual",
    text: "Un solo objeto, centrado, simple, sin texto y sin fondo. El circulo marron y la base visual los agrega el frontend.",
  },
  {
    label: "Que evitar",
    text: "Fotos reales, fondos beige, varios objetos, sombras pesadas o composiciones complejas.",
  },
];

const CATEGORY_IMAGE_PROMPT_TEMPLATE =
  "Minimalist white line icon of [CATEGORIA], centered, premium artisanal bakery branding, clean vector look, transparent background, no text, no mockup, no extra objects, designed to sit inside a dark brown circular badge, square composition.";

const CATEGORY_IMAGE_PROMPTS = [
  {
    nombre: "Alfajores",
    prompt:
      "Minimalist white line icon of an artisanal alfajor cookie sandwich, centered, premium artisanal bakery branding, transparent background, no text, no plate, no extra objects, designed to sit inside a dark brown circular badge, square composition.",
  },
  {
    nombre: "Bebidas",
    prompt:
      "Minimalist white line icon of a cold drink cup or bottle for a cafe menu, centered, premium artisanal bakery branding, transparent background, no text, no extra objects, designed to sit inside a dark brown circular badge, square composition.",
  },
  {
    nombre: "Cafeteria",
    prompt:
      "Minimalist white line icon of a takeaway coffee cup with subtle steam, centered, elegant artisanal bakery cafe style, transparent background, no text, no extra objects, designed to sit inside a dark brown circular badge, square composition.",
  },
  {
    nombre: "Confiteria",
    prompt:
      "Minimalist white line icon of assorted pastry sweets, centered, elegant artisanal confectionery style, transparent background, no text, no extra objects, designed to sit inside a dark brown circular badge, square composition.",
  },
];

const KARDEX_STOCK_EXPLANATION = [
  "El kardex es el historial del stock: muestra cada entrada, reserva, salida, liberacion o ajuste que hizo cambiar las unidades.",
  "La columna Movimiento se lee como tipo / origen. El tipo dice que paso con el stock y el origen dice de donde vino ese movimiento.",
  "Ingreso: entra stock disponible. Por ejemplo, una devolucion vuelve unidades al stock para poder venderlas otra vez.",
  "Reserva: el stock se aparta para un pedido o canje pendiente. Todavia no salio definitivamente, pero ya no queda libre para otra venta.",
  "Liberacion: una reserva vuelve al stock disponible. Liberacion / canje significa que un producto reservado para un canje de puntos se libero porque el canje se cancelo, expiro o no se entrego.",
  "Descuento: el stock sale definitivamente. Puede ser por una venta con dinero o por un canje entregado.",
  "Ajuste: correccion manual hecha desde inventario, por ejemplo para corregir una carga, rotura, diferencia fisica o conteo.",
  "Origen compra: movimiento relacionado con una venta con dinero. Origen canje: movimiento relacionado con canjes de puntos. Origen admin: cambio manual. Origen devolucion: stock que vuelve despues de una devolucion.",
];

type Stats = {
  clientes: number;
  productos: number;
  codigos_activos: number;
  canjes_pendientes: number;
  puntos_emitidos: number;
  arrepentimientos_pendientes: number;
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

type AppPresenceSummary = {
  active_now: number;
  active_clientes: number;
  active_anonimos: number;
  unique_devices_today: number;
  unique_sessions_today: number;
  registros_hoy: number;
};

type AppPresenceSession = {
  session_id: string;
  visitor_id: string;
  usuario_id: number | null;
  visitante_tipo: "anonimo" | "cliente";
  cliente_nombre: string | null;
  cliente_email: string | null;
  started_at: string;
  last_seen_at: string;
  first_path: string;
  last_path: string;
  page_title: string | null;
  referrer: string | null;
  ip: string;
  user_agent: string | null;
  page_views: number;
};

type AppPresenceLog = {
  id: number;
  session_id: string;
  visitor_id: string;
  usuario_id: number | null;
  visitante_tipo: "anonimo" | "cliente";
  cliente_nombre: string | null;
  cliente_email: string | null;
  bucket_start: string;
  bucket_end: string;
  first_seen_at: string;
  last_seen_at: string;
  first_path: string;
  last_path: string;
  page_title: string | null;
  referrer: string | null;
  ip: string;
  user_agent: string | null;
  page_views: number;
};

type AppPresenceOverviewResponse = {
  summary: AppPresenceSummary;
  active_sessions: PaginatedResponse<AppPresenceSession>;
  recent_logs: PaginatedResponse<AppPresenceLog>;
};

type Usuario = {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  tipo_cliente?: TipoCliente;
  descuento_porcentaje?: number;
  dni: string | null;
  telefono?: string | null;
  fecha_nacimiento?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  puntos_saldo: number;
  codigo_invitacion: string | null;
  activo: boolean;
  created_at: string;
};

type UpcomingBirthday = {
  usuario: Usuario;
  birthDate: string;
  nextBirthdayStamp: string;
  daysUntil: number;
  isToday: boolean;
  nextAge: number | null;
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
  sku?: string | null;
  destacado_home?: boolean;
  created_at: string;
};

type SaborAdmin = {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  inventario_sucursales?: Array<{
    sucursal_id: number;
    sucursal_nombre: string;
    stock_disponible: number;
    stock_reservado: number;
  }>;
  created_at: string;
  updated_at: string;
};

type InventarioSucursal = {
  id: number;
  producto_id: number;
  producto_nombre: string;
  sku: string | null;
  tipo_producto: "canje" | "venta" | "mixto";
  sucursal_id: number;
  sucursal_nombre: string;
  stock_disponible: number;
  stock_reservado: number;
  updated_at: string;
};

type MovimientoStock = {
  id: number;
  producto_id: number;
  producto_nombre: string;
  sku: string | null;
  sucursal_id: number | null;
  sucursal_nombre: string | null;
  orden_id: number | null;
  tipo: string;
  origen: string;
  cantidad: number;
  descripcion: string | null;
  creado_por_nombre: string | null;
  created_at: string;
};

type PostulacionCv = {
  id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  mensaje: string;
  archivo_original: string;
  archivo_disponible?: boolean;
  mime_type: string | null;
  size_bytes: number;
  estado: "nueva" | "vista" | "archivada";
  created_at: string;
};

type OrdenAdmin = {
  id: number;
  usuario_id: number | null;
  cliente_local_id?: number | null;
  cliente_local_dni?: string | null;
  cliente_local_telefono?: string | null;
  cliente_nombre: string;
  cliente_email: string | null;
  cliente_dni?: string | null;
  cliente_telefono?: string | null;
  canal: "web" | "admin" | "vendedor";
  estado: "borrador" | "pendiente_pago" | "pagada" | "preparandose" | "preparada" | "enviada" | "entregando" | "entregada" | "cancelada" | "expirada";
  tipo_orden: "canje" | "venta" | "mixta";
  total_dinero: number;
  total_puntos: number;
  moneda: string;
  sucursal_retiro_id: number | null;
  sucursal_nombre: string | null;
  sucursal?: {
    id: number;
    nombre: string | null;
    direccion: string | null;
    piso: string | null;
    localidad: string | null;
    provincia: string | null;
  } | null;
  direccion_envio?: {
    metodo_entrega?: "envio";
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
  notas: string | null;
  total_items: number;
  total_unidades: number;
  items?: Array<{
    producto_id: number;
    nombre: string;
    cantidad: number;
    modo_compra: "dinero" | "puntos";
    subtotal_dinero: number;
    subtotal_puntos: number;
    imagen_url: string | null;
    sabores?: Array<{
      sabor_id: number;
      nombre: string;
      cantidad: number;
    }>;
  }>;
  pago: {
    estado: string;
    proveedor: string;
    metodo: string | null;
    monto: number;
    moneda: string;
  } | null;
  puntos_acreditados?: boolean;
  created_at: string;
  updated_at: string;
};

type Categoria = {
  id: number;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
  orden: number;
  mostrar_en_home: boolean;
  activo: boolean;
  created_at: string;
  updated_at?: string;
};

type CategoriaDraft = {
  nombre: string;
  descripcion: string;
  imagen_url: string;
  orden: number;
  mostrar_en_home: boolean;
  activo: boolean;
};

type DescuentoCategoriaAdmin = {
  id: number;
  tipo_cliente: TipoCliente;
  categoria: string;
  descuento_porcentaje: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

type DescuentoProductoAdmin = {
  id: number;
  tipo_cliente: TipoCliente;
  producto_id: number;
  producto_nombre: string;
  categoria: string | null;
  descuento_porcentaje: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
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

type ArrepentimientoSolicitudAdmin = {
  codigo_tramite: string;
  numero_orden: string;
  nombre_apellido: string;
  email: string;
  telefono: string;
  mensaje: string;
  estado: "pendiente" | "revisado" | "resuelto" | string;
  created_at: string;
  updated_at: string;
};

type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ConfiguracionItem = {
  clave: string;
  valor: string;
  descripcion: string | null;
};

type PuntosAlertaUnidad = "semanas" | "meses";
type EventbarDescuentoEspecialTipo = "none" | "2x1" | "3x2" | "4x3";

const EVENTBAR_DESCUENTO_ESPECIAL_OPTIONS: Array<{
  value: EventbarDescuentoEspecialTipo;
  label: string;
  help: string;
}> = [
  { value: "none", label: "Sin descuento", help: "La eventbar solo comunica el evento." },
  { value: "2x1", label: "2x1", help: "Cada 2 unidades del mismo producto, paga 1." },
  { value: "3x2", label: "3x2", help: "Cada 3 unidades del mismo producto, paga 2." },
  { value: "4x3", label: "4x3", help: "Cada 4 unidades del mismo producto, paga 3." },
];

function normalizeEventbarDescuentoEspecialTipo(value: string | null | undefined): EventbarDescuentoEspecialTipo {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  if (normalized === "2x1" || normalized === "3x2" || normalized === "4x3") return normalized;
  return "none";
}

type ConfiguracionDraft = {
  dias_limite_retiro: string;
  puntos_monto_base: string;
  puntos_por_monto: string;
  puntos_vencimiento_meses: string;
  puntos_alerta_pre_vencimiento_valor: string;
  puntos_alerta_pre_vencimiento_unidad: PuntosAlertaUnidad;
  puntos_referido_invitador: string;
  puntos_referido_invitado: string;
  longitud_codigo_invitacion: string;
  envio_gratis_monto_minimo: string;
  limite_compra_cliente: string;
  limite_compra_mayorista: string;
  limite_compra_empleado: string;
  pedido_efectivo_dias_vigencia: string;
  empresa_dias_habiles_retiro: string;
  empresa_horario_retiro: string;
  pedido_comprobante_leyenda: string;
  chatbot_activo: boolean;
  eventbar_activo: boolean;
  eventbar_titulo: string;
  eventbar_subtitulo: string;
  eventbar_fecha_fin: string;
  eventbar_color_fondo: string;
  eventbar_color_texto: string;
  eventbar_descuento_especial_tipo: EventbarDescuentoEspecialTipo;
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

type ProveedorAdmin = {
  id: number;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo?: boolean;
  created_at?: string;
  updated_at?: string;
};

type CajaResumenAdmin = {
  totalVentas: number;
  totalGastos: number;
  neto: number;
  efectivoSistema: number;
  ventasPorMedio: Record<string, number>;
  gastosPorMedio: Record<string, number>;
  cantidadMovimientos: number;
};

type CajaMovimientoAdmin = {
  id: number;
  tipo: "venta" | "gasto";
  referencia_tipo: string | null;
  referencia_id: number | null;
  medio_pago: string;
  monto: number;
  descripcion: string | null;
  creado_por: number;
  creado_por_nombre: string;
  created_at: string;
};

type CajaSesionAdmin = {
  id: number;
  sucursal_id: number;
  sucursal_nombre: string;
  usuario_id: number;
  usuario_nombre: string;
  fecha_operativa: string;
  estado: "abierta" | "cerrada";
  monto_apertura: number;
  monto_cierre_sistema: number | null;
  monto_cierre_declarado: number | null;
  diferencia_cierre: number | null;
  observaciones_apertura: string | null;
  observaciones_cierre: string | null;
  apertura_at: string;
  cierre_at: string | null;
  summary: CajaResumenAdmin;
  movimientos?: CajaMovimientoAdmin[];
};

type GastoAdmin = {
  id: number;
  sucursal_id: number;
  sucursal_nombre: string;
  caja_sesion_id: number;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  tercero_nombre: string | null;
  categoria: string;
  descripcion: string;
  medio_pago: string;
  monto: number;
  fecha_gasto: string;
  notas: string | null;
  creado_por: number;
  creado_por_nombre: string;
  created_at: string;
};

type CostoCobroAdmin = {
  id: number;
  proveedor: string;
  metodo: string;
  descripcion: string;
  porcentaje: number;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
};

type ConfirmacionCanje = {
  id: number;
  estado: "entregado" | "cancelado";
  producto: string;
  cliente: string;
};

type ProductoForm = {
  nombre: string;
  sku: string;
  descripcion: string;
  categoria: string;
  tipo_producto: "canje" | "venta" | "mixto";
  configuracion_tipo: "simple" | "caja_sabores";
  capacidad_sabores: number | null;
  sabor_ids: number[];
  precio_dinero: number | null;
  puntos_requeridos: number | null;
  destacado_home: boolean;
  track_stock: boolean;
  permite_envio: boolean;
  envio_gratis: boolean;
  permite_retiro_local: boolean;
  inventario_sucursales: Record<string, number | null>;
  imagenes: string[];
  imagen_mobile_url: string;
};

type UsuarioEditDraft = {
  nombre: string;
  email: string;
  rol: Rol;
  tipo_cliente: TipoCliente;
  descuento_porcentaje: string;
  dni: string;
  telefono: string;
  fecha_nacimiento: string;
};

type WebDiscountDraft = {
  activo: boolean;
  cliente: string;
  mayorista: string;
  empleado: string;
};

type PaymentFeeDraftValue = {
  descripcion: string;
  porcentaje: string;
  activo: boolean;
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

function normalizeVentaLocalDraftSabores(
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

function sameVentaLocalDraftSabores(
  left?: Array<{ sabor_id: number; cantidad: number }>,
  right?: Array<{ sabor_id: number; cantidad: number }>,
): boolean {
  const normalizedLeft = normalizeVentaLocalDraftSabores(left as Array<{ sabor_id: number; nombre: string; cantidad: number }> | undefined);
  const normalizedRight = normalizeVentaLocalDraftSabores(right as Array<{ sabor_id: number; nombre: string; cantidad: number }> | undefined);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((sabor, index) => (
    Number(sabor.sabor_id) === Number(normalizedRight[index]?.sabor_id)
    && Number(sabor.cantidad) === Number(normalizedRight[index]?.cantidad)
  ));
}

type VentaLocalSubmitResult = {
  ordenId?: number;
  orderId?: number;
  totalDinero?: number;
  totalUnidades?: number;
  totalPuntosGanados?: number;
};

type StaticPageSlug = "terminos" | "politica-privacidad";

const MOVIMIENTOS_INICIO_POR_PAGINA = 5;
const LISTA_POR_PAGINA = 5;
const CUMPLEANOS_POR_PAGINA = 12;
const APP_PRESENCE_PAGE_SIZE = 10;
const INTENTOS_SEGURIDAD_POR_PAGINA = 5;
const MAX_PRODUCT_IMAGES = 3;
const IMAGE_FILE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const IMAGE_FILE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const ADMIN_ALERT_REDEEM_IDS_KEY = "admin_alert_known_canjes_v1";
const ADMIN_BIRTHDAY_WINDOW_MONTHS_KEY = "nande_admin_birthday_window_months";
const ADMIN_BIRTHDAY_ALERT_DAYS_KEY = "nande_admin_birthday_alert_days";
const ADMIN_BIRTHDAY_TOAST_DAY_KEY = "nande_admin_birthday_toast_day";
const DISCOUNT_CLIENT_TYPES: TipoCliente[] = ["cliente", "mayorista", "empleado"];

type AdminAlertState = {
  ordenes: number;
  canjes: number;
  arrepentimiento: number;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

function formatDate(value: string | null): string {
  return formatBuenosAiresDateTime(value);
}

function clampBirthdayWindowMonths(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(12, Math.max(1, Math.floor(value)));
}

function clampBirthdayAlertDays(value: number): number {
  if (!Number.isFinite(value)) return 14;
  return Math.min(90, Math.max(1, Math.floor(value)));
}

function getInitialBirthdayWindowMonths(): number {
  if (typeof window === "undefined") return 3;
  const raw = window.localStorage.getItem(ADMIN_BIRTHDAY_WINDOW_MONTHS_KEY);
  const parsed = Number(raw);
  return clampBirthdayWindowMonths(parsed || 3);
}

function getInitialBirthdayAlertDays(): number {
  if (typeof window === "undefined") return 14;
  const raw = window.localStorage.getItem(ADMIN_BIRTHDAY_ALERT_DAYS_KEY);
  const parsed = Number(raw);
  return clampBirthdayAlertDays(parsed || 14);
}

function parseDateOnlyParts(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const normalized = typeof value === "string" ? value.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "" : "";
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildDateStamp(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getBirthdayOccurrenceStamp(month: number, day: number, year: number): string {
  const safeDay = month === 2 && day === 29 && !isLeapYear(year)
    ? 28
    : Math.min(day, getDaysInMonth(year, month));
  return buildDateStamp(year, month, safeDay);
}

function addMonthsToDateStamp(stamp: string, monthsToAdd: number): string {
  const parts = parseDateOnlyParts(stamp);
  if (!parts) return stamp;
  const totalMonths = (parts.month - 1) + clampBirthdayWindowMonths(monthsToAdd);
  const targetYear = parts.year + Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const safeDay = Math.min(parts.day, getDaysInMonth(targetYear, targetMonth));
  return buildDateStamp(targetYear, targetMonth, safeDay);
}

function diffDaysBetweenDateStamps(fromStamp: string, toStamp: string): number {
  const from = parseDateOnlyParts(fromStamp);
  const to = parseDateOnlyParts(toStamp);
  if (!from || !to) return 0;
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.max(0, Math.round((toUtc - fromUtc) / 86400000));
}

function formatDateStamp(value: string): string {
  return formatBuenosAiresDate(`${value}T12:00:00Z`);
}

function normalizeWhatsAppPhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("549") && digits.length >= 12) return digits;
  if (digits.startsWith("54") && digits.length >= 12) {
    return digits.startsWith("549") ? digits : `549${digits.slice(2)}`;
  }
  const localDigits = digits.replace(/^0+/, "");
  if (localDigits.length < 10) return null;
  return `549${localDigits}`;
}

function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function buildBirthdayCustomerWhatsAppMessage(item: UpcomingBirthday): string {
  return item.isToday
    ? `Hola ${item.usuario.nombre}, desde Ñandé Alfajores queremos desearte un muy feliz cumpleaños. Que tengas un hermoso día.`
    : `Hola ${item.usuario.nombre}, desde Ñandé Alfajores queremos saludarte por tu próximo cumpleaños del ${formatDateStamp(item.nextBirthdayStamp)}.`;
}

function buildArrepentimientoWhatsAppMessage(item: {
  nombre_apellido: string;
  numero_orden: string;
  codigo_tramite: string;
}): string {
  return `Hola ${item.nombre_apellido}, te escribimos desde Nande Alfajores por tu solicitud de arrepentimiento del pedido ${item.numero_orden}. Tu codigo de tramite es ${item.codigo_tramite}.`;
}

function formatBirthdayCountdownLabel(daysUntil: number): string {
  if (daysUntil <= 0) return "Hoy";
  if (daysUntil === 1) return "Mañana";
  return `${daysUntil} dias`;
}

function formatBirthdayCountdownPhrase(daysUntil: number): string {
  if (daysUntil <= 0) return "hoy";
  if (daysUntil === 1) return "mañana";
  return `en ${daysUntil} dias`;
}

function isAdminTab(value: string | null): value is AdminTab {
  return value ? ADMIN_TABS.includes(value as AdminTab) : false;
}

function isVentasView(value: string | null): value is AdminVentasViewKey {
  return value === "pedidos" || value === "reportes";
}

function ventasViewFromPath(pathname: string): AdminVentasViewKey | null {
  const match = pathname.match(/\/ventas\/([^/?#]+)/);
  const segment = match?.[1];
  if (segment === "pedidos") return "pedidos";
  if (segment === "reportes") return "reportes";
  return null;
}

function isProductosTab(tab: AdminTab): boolean {
  return tab === "productos" || tab === "productos-crear" || tab === "productos-edicion" || tab === "productos-sabores";
}

function isAllowedImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const name = file.name.toLowerCase();
  return IMAGE_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function adminTabFromPath(pathname: string): AdminTab | null {
  if (/\/productos\/crear(?:[/?#]|$)/.test(pathname)) return "productos-crear";
  if (/\/productos\/edicion(?:[/?#]|$)/.test(pathname)) return "productos-edicion";
  if (/\/productos\/editar(?:[/?#]|$)/.test(pathname)) return "productos-edicion";
  if (/\/productos\/sabores(?:[/?#]|$)/.test(pathname)) return "productos-sabores";
  if (/\/productos\/listado(?:[/?#]|$)/.test(pathname)) return "productos";
  if (/\/productos(?:[/?#]|$)/.test(pathname)) return "productos";
  if (/\/cumpleanos(?:[/?#]|$)/.test(pathname)) return "cumpleanos";
  if (/\/caja(?:[/?#]|$)/.test(pathname)) return "caja";
  if (/\/gastos(?:[/?#]|$)/.test(pathname)) return "gastos";
  if (/\/proveedores(?:[/?#]|$)/.test(pathname)) return "proveedores";
  if (/\/cobros(?:[/?#]|$)/.test(pathname)) return "cobros";
  if (/\/descuentos(?:[/?#]|$)/.test(pathname)) return "descuentos";
  if (/\/postulaciones(?:[/?#]|$)/.test(pathname)) return "postulaciones";
  if (/\/personas-app(?:[/?#]|$)/.test(pathname)) return "personas-app";
  return null;
}

function ventasPathSegment(view: AdminVentasViewKey): string {
  return view;
}

function adminPathSegment(tab: AdminTab): string | null {
  if (tab === "productos") return "productos/listado";
  if (tab === "productos-crear") return "productos/crear";
  if (tab === "productos-edicion") return "productos/editar";
  if (tab === "productos-sabores") return "productos/sabores";
  if (tab === "cumpleanos") return "cumpleanos";
  if (tab === "caja") return "caja";
  if (tab === "gastos") return "gastos";
  if (tab === "proveedores") return "proveedores";
  if (tab === "cobros") return "cobros";
  if (tab === "descuentos") return "descuentos";
  if (tab === "postulaciones") return "postulaciones";
  if (tab === "personas-app") return "personas-app";
  return null;
}

function readStoredIds(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function hasStoredIds(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) !== null;
}

function writeStoredIds(key: string, ids: number[]) {
  if (typeof window === "undefined") return;
  const uniqueIds = Array.from(new Set(ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)));
  window.localStorage.setItem(key, JSON.stringify(uniqueIds.slice(0, 250)));
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

function shortPresenceId(value: string | null | undefined): string {
  const text = (value || "").trim();
  if (!text) return "-";
  return text.slice(0, 8).toUpperCase();
}

function cleanPresencePageTitle(title: string | null | undefined): string | null {
  const raw = (title || "").trim();
  if (!raw) return null;

  if (raw === "Nande Alfajores Correntinos" || raw === "Ñandé Alfajores Correntinos") {
    return "Inicio";
  }

  const splitByPipe = raw.split("|")[0]?.trim();
  if (splitByPipe) return splitByPipe;
  return raw;
}

function mapPresencePathToView(path: string | null | undefined): string {
  const raw = (path || "").trim();
  if (!raw) return "Vista sin identificar";

  const normalized = raw.split("?")[0] || raw;
  if (normalized === "/" || normalized === "/inicio") return "Inicio";
  if (normalized === "/login") return "Iniciar sesion";
  if (normalized === "/registro") return "Registro";
  if (normalized === "/forgot-password") return "Recuperar acceso";
  if (normalized === "/reset-password") return "Restablecer acceso";
  if (normalized === "/tienda") return "Tienda";
  if (normalized === "/catalogo") return "Catalogo de canjes";
  if (normalized === "/cliente") return "Panel del cliente";
  if (normalized === "/mi-perfil") return "Mi perfil";
  if (normalized === "/mis-canjes") return "Mis canjes";
  if (/^\/mis-canjes\/[^/]+$/.test(normalized)) return "Detalle de canje";
  if (normalized === "/mis-direcciones") return "Mis direcciones";
  if (normalized === "/carrito-canjes") return "Carrito de canjes";
  if (normalized === "/carrito-tienda") return "Carrito de compra";
  if (normalized === "/mis-pedidos") return "Mis pedidos";
  if (/^\/mis-pedidos\/[^/]+$/.test(normalized)) return "Detalle de pedido";
  if (normalized === "/soporte") return "Soporte";
  if (normalized === "/sobre-nosotros") return "Sobre nosotros";
  if (normalized === "/terminos") return "Terminos y condiciones";
  if (normalized === "/politica-privacidad") return "Politica de privacidad";
  if (normalized === "/boton-arrepentimiento") return "Boton de arrepentimiento";
  return normalized;
}

function formatPresenceView(path: string | null | undefined, pageTitle: string | null | undefined): string {
  const title = cleanPresencePageTitle(pageTitle);
  if (title) {
    if (title === "Nande Alfajores Correntinos" || title === "Ñandé Alfajores Correntinos") {
      return "Inicio";
    }
    return title;
  }
  return mapPresencePathToView(path);
}

function formatPresencePerson(entry: Pick<AppPresenceSession, "visitante_tipo" | "cliente_nombre" | "cliente_email" | "usuario_id">): string {
  if (entry.visitante_tipo === "anonimo") return "Usuario sin iniciar sesion";
  if (entry.cliente_nombre?.trim()) return entry.cliente_nombre.trim();
  if (entry.cliente_email?.trim()) return entry.cliente_email.trim();
  return entry.usuario_id ? `Cliente #${entry.usuario_id}` : "Cliente";
}

function formatPresenceTypeLabel(type: AppPresenceSession["visitante_tipo"]): string {
  return type === "cliente" ? "Cliente" : "Usuario no registrado";
}

const PRESENCE_ACTIVE_WINDOW_MS = 35 * 60 * 1000;

function isPresenceStillActive(lastSeenAt: string | null | undefined): boolean {
  const timestamp = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= PRESENCE_ACTIVE_WINDOW_MS;
}

function formatPresenceStillActive(lastSeenAt: string | null | undefined): string {
  return isPresenceStillActive(lastSeenAt) ? "Si" : "No";
}

async function saveBlobWithPicker(blob: Blob, filename: string, mimeType: string): Promise<"saved" | "downloaded" | "cancelled"> {
  const pickerWindow = window as SaveFilePickerWindow;
  const extensionMatch = filename.match(/\.[a-z0-9]+$/i);
  const extension = extensionMatch?.[0] ?? (mimeType === "application/pdf" ? ".pdf" : ".xlsx");

  if (pickerWindow.showSaveFilePicker) {
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: mimeType === "application/pdf" ? "Archivo PDF" : "Archivo Excel",
            accept: {
              [mimeType]: [extension],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "downloaded";
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
    cancelacion_compra: "Anulacion por cancelacion",
    vencimiento_puntos: "Vencimiento de puntos",
    ajuste: "Ajuste",
  };
  return labels[tipo] ?? tipo.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRolLabel(rol: Usuario["rol"]): string {
  if (rol === "superAdmin") return "SuperAdmin";
  if (rol === "admin") return "Administrador";
  if (rol === "vendedor") return "Vendedor";
  return "Cliente";
}

function formatTipoClienteLabel(tipo?: TipoCliente): string {
  if (tipo === "empleado") return "Empleado";
  if (tipo === "mayorista") return "Mayorista";
  return "Cliente";
}

function discountDraftKey(tipoCliente: TipoCliente, categoria: string): string {
  return `${tipoCliente}:${String(categoria || "").trim().toLowerCase()}`;
}

function productDiscountDraftKey(tipoCliente: TipoCliente, productoId: number): string {
  return `${tipoCliente}:${Number(productoId)}`;
}

function tipoClienteFromLabel(value: string): TipoCliente | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cliente" || normalized === "clientes") return "cliente";
  if (normalized === "mayorista" || normalized === "mayoristas") return "mayorista";
  if (normalized === "empleado" || normalized === "empleados") return "empleado";
  return null;
}

function eventbarDiscountPromoText(value: EventbarDescuentoEspecialTipo): string {
  if (value === "2x1" || value === "3x2" || value === "4x3") {
    return `${value.toUpperCase()} en productos seleccionados`;
  }
  return "Promos especiales en tienda online";
}

function normalizeDiscountDraftValue(value: string): string {
  if (value.trim() === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.max(0, Math.min(100, numeric)));
}

function emptyZeroInputValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (!stringValue.trim()) return "";
  const numericValue = Number(stringValue);
  if (!Number.isFinite(numericValue) || numericValue === 0) return "";
  return stringValue;
}

function isTruthyConfigValue(value: string | null | undefined): boolean {
  return ["1", "true", "si", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function normalizeHexColorInput(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "").trim();
  return isValidHexColor(normalized) ? normalized : fallback;
}

function toDatetimeLocalInputValue(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function datetimeLocalInputToIso(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString();
}

function getEventbarCountdownPreview(value: string): { days: string; hours: string; minutes: string } {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { days: "DD", hours: "HH", minutes: "MM" };
  const remainingMs = Math.max(0, date.getTime() - Date.now());
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
  };
}

function isValidConfigNavigationLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("#")) return trimmed.length > 1;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  return /^https?:\/\//i.test(trimmed);
}

function emptyZeroStockValue(value: number | string | null | undefined): number | null {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue === 0) return null;
  return numericValue;
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
    sku: "",
    descripcion: "",
    categoria: "",
    tipo_producto: "canje",
    configuracion_tipo: "simple",
    capacidad_sabores: null,
    sabor_ids: [],
    precio_dinero: null,
    puntos_requeridos: null,
    destacado_home: false,
    track_stock: true,
    permite_envio: false,
    envio_gratis: false,
    permite_retiro_local: true,
    inventario_sucursales: {},
    imagenes: [],
    imagen_mobile_url: "",
  };
}

function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

function sanitizeManualDni(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

function validateManualDni(value: string): boolean {
  return /^\d{6,10}$/.test(value.trim());
}

function formatTipoProducto(tipo?: ProductoAdmin["tipo_producto"]): string {
  if (tipo === "venta") return "Venta";
  if (tipo === "mixto") return "Mixto";
  return "Canje";
}

function formatEstadoOrden(estado: string): string {
  const labels: Record<string, string> = {
    borrador: "Borrador",
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

function formatCanalOrden(canal: string): string {
  const labels: Record<string, string> = {
    web: "Web",
    admin: "Local admin",
    vendedor: "Local vendedor",
  };
  return labels[canal] ?? canal;
}

function formatMetodoPago(metodo?: string | null): string {
  const labels: Record<string, string> = {
    cash: "Dinero en efectivo",
    transferencia: "Transferencia bancaria",
    tarjeta: "Tarjeta de credito o debito",
    qr: "Codigo QR",
    brick: "Tarjeta de credito o debito",
    wallet: "Mercado Pago app",
    otro: "Otro",
  };
  return metodo ? labels[metodo] ?? metodo : "-";
}

function formatProveedorPago(proveedor?: string | null): string {
  const labels: Record<string, string> = {
    mercadopago: "Mercado Pago",
    efectivo: "Dinero en efectivo",
    local: "Venta local",
  };
  return proveedor ? labels[proveedor] ?? proveedor : "-";
}

function formatPagoDetallado(proveedor?: string | null, metodo?: string | null): string {
  const normalizedProvider = String(proveedor ?? "").trim().toLowerCase();
  if (normalizedProvider === "mercadopago") {
    return metodo === "wallet"
      ? "Mercado Pago app"
      : metodo === "qr"
        ? "Mercado Pago / Codigo QR"
        : metodo === "brick"
          ? "Mercado Pago / Tarjeta de credito o debito"
          : "Mercado Pago";
  }
  if (normalizedProvider === "efectivo") {
    return "Dinero en efectivo";
  }
  if (normalizedProvider === "local") {
    return formatMetodoPago(metodo);
  }
  return metodo ? formatMetodoPago(metodo) : formatProveedorPago(proveedor);
}

function paymentFeeDraftKey(proveedor: string, metodo: string): string {
  return `${String(proveedor).trim().toLowerCase()}::${String(metodo).trim().toLowerCase()}`;
}

function formatPagoOrden(orden: OrdenAdmin): string {
  if (!orden.pago) return "-";
  const proveedor = formatPagoDetallado(orden.pago.proveedor, orden.pago.metodo);
  const estado = orden.pago.estado === "iniciado" ? "pendiente" : orden.pago.estado;
  return `${proveedor} / ${estado}`;
}

function isOrdenVentaLocal(orden: OrdenAdmin): boolean {
  return orden.tipo_orden === "venta" && (orden.canal === "admin" || orden.canal === "vendedor");
}

function hasOrderMapPoint(address: OrdenAdmin["direccion_envio"]): boolean {
  if (!address) return false;
  const lat = Number(address.lat);
  const lng = Number(address.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function normalizeImageList(urls: string[]): string[] {
  return urls
    .map((url) => url.trim())
    .filter((url) => Boolean(url))
    .slice(0, MAX_PRODUCT_IMAGES);
}

function formatActionError(action: string, error: unknown, detail?: string): string {
  const rawMessage = error instanceof Error ? error.message.trim() : "";
  const suffix = detail ? ` ${detail}` : "";

  if (!rawMessage) {
    return `No se pudo ${action}.${suffix}`;
  }

  if (rawMessage.includes("No se pudo conectar con el servidor")) {
    return `No se pudo ${action}. ${rawMessage}${suffix}`;
  }

  return `No se pudo ${action}. ${rawMessage}${suffix}`;
}

function productoInventoryPayload(producto: ProductoForm, sucursales: SucursalAdmin[]) {
  if (!producto.track_stock) return [];
  return sucursales
    .filter((sucursal) => sucursal.activo)
    .map((sucursal) => ({
      sucursal_id: sucursal.id,
      stock_disponible: Math.max(0, Number(producto.inventario_sucursales[String(sucursal.id)] ?? 0) || 0),
    }));
}

function stockDraftPayload(values: Record<string, number | null>, sucursales: SucursalAdmin[]) {
  return sucursales
    .filter((sucursal) => sucursal.activo)
    .map((sucursal) => ({
      sucursal_id: sucursal.id,
      stock_disponible: Math.max(0, Number(values[String(sucursal.id)] ?? 0) || 0),
    }));
}

function inventoryDraftFromRows(rows: InventarioSucursal[] | undefined, sucursales: SucursalAdmin[]): Record<string, number | null> {
  const draft: Record<string, number | null> = {};
  for (const sucursal of sucursales) {
    const row = rows?.find((item) => Number(item.sucursal_id) === Number(sucursal.id));
    draft[String(sucursal.id)] = row ? emptyZeroStockValue(row.stock_disponible) : null;
  }
  return draft;
}

function flavorInventoryDraftFromRows(rows: SaborAdmin["inventario_sucursales"] | undefined, sucursales: SucursalAdmin[]): Record<string, number | null> {
  const draft: Record<string, number | null> = {};
  for (const sucursal of sucursales) {
    const row = rows?.find((item) => Number(item.sucursal_id) === Number(sucursal.id));
    draft[String(sucursal.id)] = row ? emptyZeroStockValue(row.stock_disponible) : null;
  }
  return draft;
}

function formatSucursalAddress(sucursal: SucursalAdmin): string {
  return [sucursal.direccion, sucursal.piso ? `Piso ${sucursal.piso}` : "", sucursal.localidad, sucursal.provincia]
    .filter(Boolean)
    .join(", ");
}

function ProductInventoryEditor({
  sucursales,
  values,
  rows,
  tip,
  onChangeStock,
}: {
  sucursales: SucursalAdmin[];
  values: Record<string, number | null>;
  rows?: Array<{ sucursal_id: number; stock_disponible: number; stock_reservado: number }>;
  tip: string;
  onChangeStock: (sucursalId: number, stock: number | null) => void;
}) {
  const activeSucursales = sucursales.filter((sucursal) => sucursal.activo);
  const [selectedSucursalId, setSelectedSucursalId] = useState(() => activeSucursales[0]?.id ? String(activeSucursales[0].id) : "");

  useEffect(() => {
    if (!activeSucursales.length) {
      setSelectedSucursalId("");
      return;
    }
    if (!activeSucursales.some((sucursal) => String(sucursal.id) === selectedSucursalId)) {
      setSelectedSucursalId(String(activeSucursales[0].id));
    }
  }, [activeSucursales, selectedSucursalId]);

  const selectedSucursal = activeSucursales.find((sucursal) => String(sucursal.id) === selectedSucursalId) ?? activeSucursales[0];
  const selectedRow = selectedSucursal
    ? rows?.find((item) => Number(item.sucursal_id) === Number(selectedSucursal.id))
    : undefined;
  const selectedKey = selectedSucursal ? String(selectedSucursal.id) : "";
  const hasDraftStock = selectedKey ? Object.prototype.hasOwnProperty.call(values, selectedKey) : false;
  const selectedStockDisponible = selectedKey
    ? hasDraftStock
      ? values[selectedKey]
      : selectedRow
        ? emptyZeroStockValue(selectedRow.stock_disponible)
        : null
    : null;
  const selectedStockReservado = Number(selectedRow?.stock_reservado ?? 0);

  return (
    <div className="adm-inventory-editor">
      <p className="adm-inline-tip">{tip}</p>
      {activeSucursales.length === 0 ? (
        <div className="adm-empty">No hay sucursales activas. Activa o crea una sucursal antes de cargar stock.</div>
      ) : (
        <>
          <label className="adm-field adm-inventory-sucursal-select">
            <span className="adm-label">Sucursal donde va el producto</span>
            <select
              className="adm-input"
              value={selectedSucursalId}
              onChange={(event) => setSelectedSucursalId(event.target.value)}
            >
              {activeSucursales.map((sucursal) => (
                <option key={sucursal.id} value={sucursal.id}>
                  {sucursal.nombre}
                </option>
              ))}
            </select>
          </label>

          {selectedSucursal ? (
            <div className="adm-inventory-branch-card">
              <div className="adm-inventory-branch-main">
                <div>
                  <p className="adm-inventory-branch-name">{selectedSucursal.nombre}</p>
                  <p className="adm-inventory-branch-address">{formatSucursalAddress(selectedSucursal)}</p>
                </div>
                <span className="adm-inventory-branch-status">Activa</span>
              </div>

              <div className="adm-inventory-stock-row">
                <label className="adm-field adm-inventory-stock-field">
                  <span className="adm-label">Stock disponible en esta sucursal</span>
                  <input
                    type="number"
                    min={0}
                    className="adm-input"
                    value={selectedStockDisponible ?? ""}
                    onChange={(event) => onChangeStock(selectedSucursal.id, event.target.value ? Number(event.target.value) : null)}
                  />
                </label>
                <div className="adm-inventory-reserved-box">
                  <span>Reservado</span>
                  <strong>{selectedStockReservado}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
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
  const [open, setOpen] = useState(false);

  return (
    <div className="adm-label-wrap">
      <span className="adm-label">
        {text}
        <button
          type="button"
          className="adm-tip"
          aria-label={`Ayuda: ${text}`}
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          ?
        </button>
      </span>
      {open ? (
        <span className="adm-tip-inline" role="tooltip">
          {tip}
        </span>
      ) : null}
    </div>
  );
}

function FloatingTip({ label, tip }: { label: string; tip: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="adm-floating-tip-wrap">
      <button
        type="button"
        className="adm-tip adm-floating-tip"
        aria-label={`Ayuda: ${label}`}
        aria-expanded={open}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((prev) => !prev)}
      >
        ?
      </button>
      {open ? (
        <span className="adm-tip-inline adm-floating-tip-popover" role="tooltip">
          {tip}
        </span>
      ) : null}
    </span>
  );
}

function FieldWithFloatingTip({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  return (
    <div className="adm-field-with-tip">
      {children}
      <FloatingTip label={label} tip={tip} />
    </div>
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
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, confirmToast } = useToast();
  const adminContentRef = useRef<HTMLDivElement | null>(null);
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const isSuperAdmin = user?.rol === "superAdmin";
  const panelBasePath = isSuperAdmin ? "/superadmin" : "/admin";
  const isSuperAdminPanel = location.pathname.startsWith("/superadmin");

  const [tab, setTab] = useState<AdminTab>("inicio");
  const [ventasView, setVentasView] = useState<AdminVentasViewKey>("pedidos");
  const [ventasNavOpen, setVentasNavOpen] = useState(false);
  const [productosNavOpen, setProductosNavOpen] = useState(false);
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
  const [nuevoSabor, setNuevoSabor] = useState<{ nombre: string; descripcion: string; inventario_sucursales: Record<string, number | null> }>({
    nombre: "",
    descripcion: "",
    inventario_sucursales: {},
  });
  const [editUsuarioId, setEditUsuarioId] = useState<number | null>(null);
  const [editUsuarioDraft, setEditUsuarioDraft] = useState<UsuarioEditDraft>({
    nombre: "",
    email: "",
    rol: "cliente",
    tipo_cliente: "cliente",
    descuento_porcentaje: "",
    dni: "",
    telefono: "",
    fecha_nacimiento: "",
  });
  const [adminHint, setAdminHint] = useState("");

  const [nuevaCategoria, setNuevaCategoria] = useState<CategoriaDraft>({ nombre: "", descripcion: "", imagen_url: "", orden: 0, mostrar_en_home: false, activo: true });
  const [categoriaEditId, setCategoriaEditId] = useState<number | null>(null);
  const [categoriaEditDraft, setCategoriaEditDraft] = useState<CategoriaDraft>({ nombre: "", descripcion: "", imagen_url: "", orden: 0, mostrar_en_home: false, activo: true });
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
    rol: "cliente" as Rol,
    tipo_cliente: "cliente" as TipoCliente,
    descuento_porcentaje: "",
    dni: "",
  });
  const [busquedaUsuarios, setBusquedaUsuarios] = useState("");
  const [cumpleanosPage, setCumpleanosPage] = useState(1);
  const [cumpleanosWindowMonths, setCumpleanosWindowMonths] = useState(() => getInitialBirthdayWindowMonths());
  const [cumpleanosWindowMonthsDraft, setCumpleanosWindowMonthsDraft] = useState(() => String(getInitialBirthdayWindowMonths()));
  const [cumpleanosAlertDays, setCumpleanosAlertDays] = useState(() => getInitialBirthdayAlertDays());
  const [cumpleanosAlertDaysDraft, setCumpleanosAlertDaysDraft] = useState(() => String(getInitialBirthdayAlertDays()));
  const [busquedaProductos, setBusquedaProductos] = useState("");
  const [filtroTipoProducto, setFiltroTipoProducto] = useState("");
  const [movimientosInicioPage, setMovimientosInicioPage] = useState(1);
  const [usuariosPage, setUsuariosPage] = useState(1);
  const [productosPage, setProductosPage] = useState(1);
  const [inventarioPage, setInventarioPage] = useState(1);
  const [postulacionesPage, setPostulacionesPage] = useState(1);
  const [ordenesPage, setOrdenesPage] = useState(1);
  const [categoriasPage, setCategoriasPage] = useState(1);
  const [transaccionesPage, setTransaccionesPage] = useState(1);
  const [canjesPage, setCanjesPage] = useState(1);
  const [codigosPage, setCodigosPage] = useState(1);
  const [sucursalesPage, setSucursalesPage] = useState(1);
  const [seguridadPage, setSeguridadPage] = useState(1);
  const [appPresenceActivePage, setAppPresenceActivePage] = useState(1);
  const [appPresenceRecentPage, setAppPresenceRecentPage] = useState(1);
  const [busquedaInventario, setBusquedaInventario] = useState("");
  const [busquedaPostulaciones, setBusquedaPostulaciones] = useState("");
  const [busquedaOrdenes, setBusquedaOrdenes] = useState("");
  const [ordenesFiltroEstado, setOrdenesFiltroEstado] = useState("");
  const [ordenesFiltroEntrega, setOrdenesFiltroEntrega] = useState("");
  const [cancelacionOrden, setCancelacionOrden] = useState<{
    orden: OrdenAdmin;
    motivo: string;
    mensaje_devolucion: string;
  } | null>(null);
  const [ordenExpandidaId, setOrdenExpandidaId] = useState<number | null>(null);
  const [ventaLocalClienteId, setVentaLocalClienteId] = useState("");
  const [ventaLocalClienteManualNombre, setVentaLocalClienteManualNombre] = useState("");
  const [ventaLocalClienteManualDni, setVentaLocalClienteManualDni] = useState("");
  const [ventaLocalSucursalId, setVentaLocalSucursalId] = useState("");
  const [ventaLocalMetodoPago, setVentaLocalMetodoPago] = useState("cash");
  const [ventaLocalProductoId, setVentaLocalProductoId] = useState("");
  const [ventaLocalCantidad, setVentaLocalCantidad] = useState("1");
  const [ventaLocalSabores, setVentaLocalSabores] = useState<Record<string, string>>({});
  const [ventaLocalItems, setVentaLocalItems] = useState<VentaLocalItemDraft[]>([]);
  const [ventaLocalProductoBusqueda, setVentaLocalProductoBusqueda] = useState("");
  const [ventaLocalEditOrdenId, setVentaLocalEditOrdenId] = useState<number | null>(null);
  const [ventasExportCanal, setVentasExportCanal] = useState("");
  const [ventasExportDesde, setVentasExportDesde] = useState("");
  const [ventasExportHasta, setVentasExportHasta] = useState("");
  const [cajaSucursalId, setCajaSucursalId] = useState("");
  const [cajaMontoApertura, setCajaMontoApertura] = useState("");
  const [cajaMontoCierre, setCajaMontoCierre] = useState("");
  const [cajaObservacionesApertura, setCajaObservacionesApertura] = useState("");
  const [cajaObservacionesCierre, setCajaObservacionesCierre] = useState("");
  const [cajaEditSesion, setCajaEditSesion] = useState<CajaSesionAdmin | null>(null);
  const [cajaReporteFecha, setCajaReporteFecha] = useState(() => getBuenosAiresDateStamp());
  const [cajaSesionesPage, setCajaSesionesPage] = useState(1);
  const [gastoProveedorId, setGastoProveedorId] = useState("");
  const [gastoTerceroNombre, setGastoTerceroNombre] = useState("");
  const [gastoCategoria, setGastoCategoria] = useState("");
  const [gastoDescripcion, setGastoDescripcion] = useState("");
  const [gastoMonto, setGastoMonto] = useState("");
  const [gastoMedioPago, setGastoMedioPago] = useState("cash");
  const [gastoNotas, setGastoNotas] = useState("");
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
  const [nuevoProveedor, setNuevoProveedor] = useState({
    nombre: "",
    contacto: "",
    telefono: "",
    email: "",
    notas: "",
  });
  const [proveedorEditId, setProveedorEditId] = useState<number | null>(null);
  const [proveedorEditDraft, setProveedorEditDraft] = useState({
    nombre: "",
    contacto: "",
    telefono: "",
    email: "",
    notas: "",
    activo: true,
  });
  const [inventarioDraft, setInventarioDraft] = useState<Record<string, string>>({});
  const [inventarioFiltroSucursal, setInventarioFiltroSucursal] = useState("");
  const [inventarioFiltroProducto, setInventarioFiltroProducto] = useState("");
  const [asignacionUsuarioId, setAsignacionUsuarioId] = useState<number | null>(null);
  const [asignacionPuntos, setAsignacionPuntos] = useState("");
  const [asignacionDescripcion, setAsignacionDescripcion] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState("");
  const [configErr, setConfigErr] = useState("");
  const [eventbarMsg, setEventbarMsg] = useState("");
  const [eventbarErr, setEventbarErr] = useState("");
  const [webDiscountLoaded, setWebDiscountLoaded] = useState(false);
  const [webDiscountDraft, setWebDiscountDraft] = useState<WebDiscountDraft>({
    activo: false,
    cliente: "",
    mayorista: "",
    empleado: "",
  });
  const [webDiscountProfileSearch, setWebDiscountProfileSearch] = useState("Cliente");
  const [webDiscountSelectedType, setWebDiscountSelectedType] = useState<TipoCliente>("cliente");
  const [costosCobroLoaded, setCostosCobroLoaded] = useState(false);
  const [costosCobroDraft, setCostosCobroDraft] = useState<Record<string, PaymentFeeDraftValue>>({});
  const [descuentosCategoriasLoaded, setDescuentosCategoriasLoaded] = useState(false);
  const [descuentosCategoriasDraft, setDescuentosCategoriasDraft] = useState<Record<string, string>>({});
  const [descuentosProductosLoaded, setDescuentosProductosLoaded] = useState(false);
  const [descuentosProductosDraft, setDescuentosProductosDraft] = useState<Record<string, string>>({});
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [backupErr, setBackupErr] = useState("");
  const [configDraft, setConfigDraft] = useState<ConfiguracionDraft>({
    dias_limite_retiro: "7",
    puntos_monto_base: "1000",
    puntos_por_monto: "20",
    puntos_vencimiento_meses: "6",
    puntos_alerta_pre_vencimiento_valor: "1",
    puntos_alerta_pre_vencimiento_unidad: "meses",
    puntos_referido_invitador: "50",
    puntos_referido_invitado: "30",
    longitud_codigo_invitacion: "9",
    envio_gratis_monto_minimo: "",
    limite_compra_cliente: "100",
    limite_compra_mayorista: "100",
    limite_compra_empleado: "100",
    pedido_efectivo_dias_vigencia: "3",
    empresa_dias_habiles_retiro: "Lunes a viernes",
    empresa_horario_retiro: "08:00 a 18:00",
    pedido_comprobante_leyenda: "Este documento no es valido como factura.",
    chatbot_activo: true,
    eventbar_activo: false,
    eventbar_titulo: "",
    eventbar_subtitulo: "",
    eventbar_fecha_fin: "",
    eventbar_color_fondo: "#2D1A0D",
    eventbar_color_texto: "#F3C47B",
    eventbar_descuento_especial_tipo: "none",
  });
  const [nuevaSucursal, setNuevaSucursal] = useState<SucursalForm>(emptySucursalForm());
  const [editSucursalId, setEditSucursalId] = useState<number | null>(null);
  const [editSucursalDraft, setEditSucursalDraft] = useState<SucursalForm>(emptySucursalForm());

  const [terminosDraft, setTerminosDraft] = useState<EditorDraft>({
    titulo: "",
    contenido: "",
    okMsg: "",
    errMsg: "",
  });
  const [politicaPrivacidadDraft, setPoliticaPrivacidadDraft] = useState<EditorDraft>({
    titulo: "",
    contenido: "",
    okMsg: "",
    errMsg: "",
  });
  const [arrepentimientoSearch, setArrepentimientoSearch] = useState("");
  const [arrepentimientoPage, setArrepentimientoPage] = useState(1);
  const [arrepentimientoModalItem, setArrepentimientoModalItem] = useState<ArrepentimientoSolicitudAdmin | null>(null);

  const [confirmacion, setConfirmacion] = useState<ConfirmacionCanje | null>(null);
  const [codigoCanjeAdmin, setCodigoCanjeAdmin] = useState("");
  const [canjeCodigoAdmin, setCanjeCodigoAdmin] = useState<CanjeCodigoAdmin | null>(null);
  const [canjeCodigoAdminErr, setCanjeCodigoAdminErr] = useState("");
  const [canjeCodigoAdminOk, setCanjeCodigoAdminOk] = useState("");
  const [buscandoCanjeAdmin, setBuscandoCanjeAdmin] = useState(false);
  const [procesandoCanjeAdmin, setProcesandoCanjeAdmin] = useState(false);
  const [adminAlerts, setAdminAlerts] = useState<AdminAlertState>({ ordenes: 0, canjes: 0, arrepentimiento: 0 });
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported",
  );

  const statsQuery = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<Stats>("/admin/stats"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const usuariosQuery = useQuery({
    queryKey: ["admin", "usuarios"],
    queryFn: () => api.get<Usuario[]>("/admin/usuarios"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const movimientosQuery = useQuery({
    queryKey: ["admin", "movimientos"],
    queryFn: () => api.get<Movimiento[]>("/admin/movimientos"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const productosQuery = useQuery({
    queryKey: ["admin", "productos"],
    queryFn: () => api.get<ProductoAdmin[]>("/admin/productos"),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const saboresQuery = useQuery({
    queryKey: ["admin", "sabores"],
    queryFn: () => api.get<SaborAdmin[]>("/admin/sabores"),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const inventarioQuery = useQuery({
    queryKey: ["admin", "inventario"],
    queryFn: () => api.get<InventarioSucursal[]>("/admin/inventario"),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const movimientosStockQuery = useQuery({
    queryKey: ["admin", "movimientos-stock"],
    queryFn: () => api.get<MovimientoStock[]>("/admin/movimientos-stock"),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const postulacionesQuery = useQuery({
    queryKey: ["admin", "postulaciones"],
    queryFn: () => api.get<PostulacionCv[]>("/postulaciones/admin"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const ordenesQuery = useQuery({
    queryKey: ["admin", "ordenes"],
    queryFn: () => api.get<OrdenAdmin[]>("/admin/ordenes"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const categoriasQuery = useQuery({
    queryKey: ["admin", "categorias"],
    queryFn: () => api.get<Categoria[]>("/admin/categorias"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const descuentosCategoriasQuery = useQuery({
    queryKey: ["admin", "descuentos-categorias"],
    queryFn: () => api.get<DescuentoCategoriaAdmin[]>("/admin/descuentos-categorias"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const descuentosProductosQuery = useQuery({
    queryKey: ["admin", "descuentos-productos"],
    queryFn: () => api.get<DescuentoProductoAdmin[]>("/admin/descuentos-productos"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const codigosQuery = useQuery({
    queryKey: ["admin", "codigos"],
    queryFn: () => api.get<Codigo[]>("/admin/codigos"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const canjesQuery = useQuery({
    queryKey: ["admin", "canjes"],
    queryFn: () => api.get<CanjeAdmin[]>("/admin/canjes"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const sucursalesQuery = useQuery({
    queryKey: ["admin", "sucursales"],
    queryFn: () => api.get<SucursalAdmin[]>("/admin/sucursales"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const proveedoresQuery = useQuery({
    queryKey: ["admin", "proveedores"],
    queryFn: () => api.get<ProveedorAdmin[]>("/admin/proveedores"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const costosCobroQuery = useQuery({
    queryKey: ["admin", "costos-cobro"],
    queryFn: () => api.get<CostoCobroAdmin[]>("/admin/costos-cobro"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const cajaActualQuery = useQuery({
    queryKey: ["admin", "caja-actual", cajaSucursalId],
    queryFn: () => api.get<CajaSesionAdmin | null>(`/admin/caja/actual?sucursal_id=${Number(cajaSucursalId)}`),
    enabled: Number(cajaSucursalId) > 0,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const cajaSesionesQuery = useQuery({
    queryKey: ["admin", "caja-sesiones", cajaSucursalId, cajaSesionesPage],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(cajaSesionesPage),
        limit: "12",
      });
      if (Number(cajaSucursalId) > 0) params.set("sucursal_id", String(Number(cajaSucursalId)));
      return api.get<PaginatedResponse<CajaSesionAdmin>>(`/admin/caja/sesiones?${params.toString()}`);
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const gastosQuery = useQuery({
    queryKey: ["admin", "gastos", cajaSucursalId],
    queryFn: () => api.get<GastoAdmin[]>(`/admin/gastos${Number(cajaSucursalId) > 0 ? `?sucursal_id=${Number(cajaSucursalId)}` : ""}`),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const configuracionQuery = useQuery({
    queryKey: ["admin", "configuracion"],
    queryFn: () => api.get<ConfiguracionItem[]>("/admin/configuracion"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const securityMonitorQuery = useQuery({
    queryKey: ["admin", "security-monitor"],
    queryFn: () => api.get<SecurityMonitorResponse>("/admin/security/monitor?limit=80"),
    enabled: isSuperAdmin,
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const appPresenceOverviewQuery = useQuery({
    queryKey: ["admin", "personas-app", appPresenceActivePage, appPresenceRecentPage],
    queryFn: () => api.get<AppPresenceOverviewResponse>(`/admin/personas-app?active_page=${appPresenceActivePage}&recent_page=${appPresenceRecentPage}&page_size=${APP_PRESENCE_PAGE_SIZE}`),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const terminosQuery = useQuery({
    queryKey: ["admin", "paginas", "terminos"],
    queryFn: () => api.get<Pagina>("/admin/paginas/terminos"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const politicaPrivacidadQuery = useQuery({
    queryKey: ["admin", "paginas", "politica-privacidad"],
    queryFn: () => api.get<Pagina>("/admin/paginas/politica-privacidad"),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const arrepentimientoQuery = useQuery({
    queryKey: ["admin", "arrepentimiento", arrepentimientoPage, arrepentimientoSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(arrepentimientoPage),
        limit: "10",
      });
      if (arrepentimientoSearch.trim()) params.set("q", arrepentimientoSearch.trim());
      return api.get<PaginatedResponse<ArrepentimientoSolicitudAdmin>>(`/admin/arrepentimiento?${params.toString()}`);
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

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
    if (!politicaPrivacidadQuery.data) return;
    setPoliticaPrivacidadDraft((prev) =>
      prev.titulo || prev.contenido
        ? prev
        : {
            ...prev,
            titulo: politicaPrivacidadQuery.data.titulo,
            contenido: politicaPrivacidadQuery.data.contenido,
          },
    );
  }, [politicaPrivacidadQuery.data]);

  useEffect(() => {
    setArrepentimientoPage(1);
  }, [arrepentimientoSearch]);

  useEffect(() => {
    const totalPages = arrepentimientoQuery.data?.totalPages ?? 1;
    if (arrepentimientoPage > totalPages) {
      setArrepentimientoPage(totalPages);
    }
  }, [arrepentimientoPage, arrepentimientoQuery.data?.totalPages]);

  useEffect(() => {
    if (!adminHint) return;
    const timer = window.setTimeout(() => setAdminHint(""), 5200);
    return () => window.clearTimeout(timer);
  }, [adminHint]);

  useEffect(() => {
    if (cajaSucursalId) return;
    const firstActiveSucursal = sucursalesQuery.data?.find((item) => item.activo);
    if (firstActiveSucursal) {
      setCajaSucursalId(String(firstActiveSucursal.id));
    }
  }, [cajaSucursalId, sucursalesQuery.data]);

  useEffect(() => {
    if (ventaLocalEditOrdenId || ventaLocalSucursalId) return;
    const firstActiveSucursal = sucursalesQuery.data?.find((item) => item.activo);
    if (firstActiveSucursal) {
      setVentaLocalSucursalId(String(firstActiveSucursal.id));
    }
  }, [sucursalesQuery.data, ventaLocalEditOrdenId, ventaLocalSucursalId]);

  useEffect(() => {
    setCajaSesionesPage(1);
  }, [cajaSucursalId]);

  useEffect(() => {
    const totalPages = cajaSesionesQuery.data?.totalPages ?? 1;
    if (totalPages < cajaSesionesPage) {
      setCajaSesionesPage(totalPages);
    }
  }, [cajaSesionesPage, cajaSesionesQuery.data?.totalPages]);

  useEffect(() => {
    if (/\/ventas\/local(?:[/?#]|$)/.test(location.pathname)) {
      navigate(`${panelBasePath}/ventas/pedidos`, { replace: true });
      return;
    }

    const requestedVentasPathView = ventasViewFromPath(location.pathname);
    if (requestedVentasPathView) {
      setTab("ordenes");
      setVentasView((prev) => (requestedVentasPathView !== prev ? requestedVentasPathView : prev));
      setVentasNavOpen(true);
      return;
    }

    const requestedDirectTab = adminTabFromPath(location.pathname);
    if (requestedDirectTab) {
      setTab(requestedDirectTab);
      setVentasNavOpen(false);
      setProductosNavOpen(isProductosTab(requestedDirectTab));
      return;
    }

    const params = new URLSearchParams(location.search);
    const requestedTab = params.get("tab");
    const requestedVentasView = params.get("vista");

    if (isAdminTab(requestedTab)) {
      setTab((prev) => (requestedTab !== prev ? requestedTab : prev));
    }

    if (requestedTab === "ordenes") {
      const nextVentasView = isVentasView(requestedVentasView) ? requestedVentasView : "pedidos";
      setVentasView((prev) => (nextVentasView !== prev ? nextVentasView : prev));
      setVentasNavOpen(true);
      navigate(`${panelBasePath}/ventas/${ventasPathSegment(nextVentasView)}`, { replace: true });
    } else if (isAdminTab(requestedTab)) {
      setVentasNavOpen(false);
      setProductosNavOpen(isProductosTab(requestedTab));
    }
  }, [location.pathname, location.search, navigate, panelBasePath]);

  useEffect(() => {
    const requestedOrderId = Number(new URLSearchParams(location.search).get("pedido") ?? 0);
    if (!Number.isInteger(requestedOrderId) || requestedOrderId <= 0) return;
    if (!ventasViewFromPath(location.pathname)) return;
    openOrderFromToast(requestedOrderId);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!configuracionQuery.data) return;
    if (configLoaded) return;
    const getConfig = (clave: keyof ConfiguracionDraft, fallback: string) =>
      configuracionQuery.data?.find((item) => item.clave === clave)?.valor ?? fallback;
    setConfigDraft({
      dias_limite_retiro: getConfig("dias_limite_retiro", "7"),
      puntos_monto_base: getConfig("puntos_monto_base", "1000"),
      puntos_por_monto: getConfig("puntos_por_monto", "20"),
      puntos_vencimiento_meses: getConfig("puntos_vencimiento_meses", "6"),
      puntos_alerta_pre_vencimiento_valor: getConfig("puntos_alerta_pre_vencimiento_valor", "1"),
      puntos_alerta_pre_vencimiento_unidad: getConfig("puntos_alerta_pre_vencimiento_unidad", "meses") === "semanas" ? "semanas" : "meses",
      puntos_referido_invitador: getConfig("puntos_referido_invitador", "50"),
      puntos_referido_invitado: getConfig("puntos_referido_invitado", "30"),
      longitud_codigo_invitacion: getConfig("longitud_codigo_invitacion", "9"),
      envio_gratis_monto_minimo: emptyZeroInputValue(getConfig("envio_gratis_monto_minimo", "0")),
      limite_compra_cliente: emptyZeroInputValue(getConfig("limite_compra_cliente", "100")),
      limite_compra_mayorista: emptyZeroInputValue(getConfig("limite_compra_mayorista", "100")),
      limite_compra_empleado: emptyZeroInputValue(getConfig("limite_compra_empleado", "100")),
      pedido_efectivo_dias_vigencia: getConfig("pedido_efectivo_dias_vigencia", "3"),
      empresa_dias_habiles_retiro: getConfig("empresa_dias_habiles_retiro", "Lunes a viernes"),
      empresa_horario_retiro: getConfig("empresa_horario_retiro", "08:00 a 18:00"),
      pedido_comprobante_leyenda: getConfig("pedido_comprobante_leyenda", "Este documento no es valido como factura."),
      chatbot_activo: isTruthyConfigValue(getConfig("chatbot_activo", "1")),
      eventbar_activo: isTruthyConfigValue(getConfig("eventbar_activo", "0")),
      eventbar_titulo: getConfig("eventbar_titulo", ""),
      eventbar_subtitulo: getConfig("eventbar_subtitulo", ""),
      eventbar_fecha_fin: toDatetimeLocalInputValue(getConfig("eventbar_fecha_fin", "")),
      eventbar_color_fondo: normalizeHexColorInput(getConfig("eventbar_color_fondo", "#2D1A0D"), "#2D1A0D"),
      eventbar_color_texto: normalizeHexColorInput(getConfig("eventbar_color_texto", "#F3C47B"), "#F3C47B"),
      eventbar_descuento_especial_tipo: normalizeEventbarDescuentoEspecialTipo(getConfig("eventbar_descuento_especial_tipo", "none")),
    });
    setConfigLoaded(true);
  }, [configLoaded, configuracionQuery.data]);

  useEffect(() => {
    if (!configuracionQuery.data || webDiscountLoaded) return;
    const byKey = new Map(configuracionQuery.data.map((item) => [item.clave, item.valor]));
    const activeValue = String(byKey.get("descuento_web_global_activo") ?? "0").trim().toLowerCase();
    setWebDiscountDraft({
      activo: activeValue === "1" || activeValue === "true" || activeValue === "si" || activeValue === "yes" || activeValue === "on",
      cliente: emptyZeroInputValue(byKey.get("descuento_web_global_cliente")),
      mayorista: emptyZeroInputValue(byKey.get("descuento_web_global_mayorista")),
      empleado: emptyZeroInputValue(byKey.get("descuento_web_global_empleado")),
    });
    setWebDiscountLoaded(true);
  }, [configuracionQuery.data, webDiscountLoaded]);

  useEffect(() => {
    if (!costosCobroQuery.data || costosCobroLoaded) return;
    const nextDraft: Record<string, PaymentFeeDraftValue> = {};
    for (const item of costosCobroQuery.data) {
      nextDraft[paymentFeeDraftKey(item.proveedor, item.metodo)] = {
        descripcion: item.descripcion,
        porcentaje: emptyZeroInputValue(item.porcentaje),
        activo: Boolean(item.activo),
      };
    }
    setCostosCobroDraft(nextDraft);
    setCostosCobroLoaded(true);
  }, [costosCobroLoaded, costosCobroQuery.data]);

  useEffect(() => {
    if (!(categoriasQuery.data?.length) || !descuentosCategoriasQuery.data || descuentosCategoriasLoaded) return;
    const currentRows = new Map(
      descuentosCategoriasQuery.data.map((item) => [
        discountDraftKey(item.tipo_cliente, item.categoria),
        item.activo ? emptyZeroInputValue(item.descuento_porcentaje) : "",
      ]),
    );
    const nextDraft: Record<string, string> = {};
    for (const categoria of categoriasQuery.data.filter((item) => item.activo !== false)) {
      for (const tipoCliente of DISCOUNT_CLIENT_TYPES) {
        const key = discountDraftKey(tipoCliente, categoria.nombre);
        nextDraft[key] = currentRows.get(key) ?? "";
      }
    }
    setDescuentosCategoriasDraft(nextDraft);
    setDescuentosCategoriasLoaded(true);
  }, [categoriasQuery.data, descuentosCategoriasLoaded, descuentosCategoriasQuery.data]);

  useEffect(() => {
    if (!(productosQuery.data?.length) || !descuentosProductosQuery.data || descuentosProductosLoaded) return;
    const currentRows = new Map(
      descuentosProductosQuery.data.map((item) => [
        productDiscountDraftKey(item.tipo_cliente, item.producto_id),
        item.activo ? emptyZeroInputValue(item.descuento_porcentaje) : "",
      ]),
    );
    const nextDraft: Record<string, string> = {};
    for (const producto of productosQuery.data.filter((item) =>
      item.activo !== false &&
      (item.tipo_producto === "venta" || item.tipo_producto === "mixto") &&
      Number(item.precio_dinero ?? item.precio_dinero_original ?? 0) > 0
    )) {
      for (const tipoCliente of DISCOUNT_CLIENT_TYPES) {
        const key = productDiscountDraftKey(tipoCliente, Number(producto.id));
        nextDraft[key] = currentRows.get(key) ?? "";
      }
    }
    setDescuentosProductosDraft(nextDraft);
    setDescuentosProductosLoaded(true);
  }, [descuentosProductosLoaded, descuentosProductosQuery.data, productosQuery.data]);

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

  function irAPanelSucursales() {
    navigate(`${panelBasePath}/sucursales`);
  }

  function irAPanelEnvios() {
    navigate(`${panelBasePath}/envios`);
  }

  function syncAdminUrl(nextTab: AdminTab, nextVentasView?: AdminVentasViewKey) {
    if (nextTab === "ordenes") {
      navigate(`${panelBasePath}/ventas/${ventasPathSegment(nextVentasView ?? ventasView)}`);
      return;
    }

    const directPath = adminPathSegment(nextTab);
    if (directPath) {
      navigate(`${panelBasePath}/${directPath}`);
      return;
    }

    const params = new URLSearchParams();
    params.set("tab", nextTab);
    navigate(`${panelBasePath}?${params.toString()}`);
  }

  function scrollAdminContentToTop() {
    window.requestAnimationFrame(() => {
      adminContentRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function seleccionarTab(nextTab: AdminTab) {
    setTab(nextTab);
    if (nextTab !== "ordenes") {
      setVentasNavOpen(false);
    }
    if (!isProductosTab(nextTab)) {
      setProductosNavOpen(false);
    }
    syncAdminUrl(nextTab);
    scrollAdminContentToTop();
  }

  function abrirVistaProductos(nextTab: Extract<AdminTab, "productos" | "productos-crear" | "productos-edicion" | "productos-sabores">) {
    setTab(nextTab);
    setProductosNavOpen(true);
    setVentasNavOpen(false);
    syncAdminUrl(nextTab);
    scrollAdminContentToTop();
  }

  function abrirVistaVentas(view: AdminVentasViewKey) {
    setTab("ordenes");
    setVentasView(view);
    setVentasNavOpen(true);
    setProductosNavOpen(false);
    syncAdminUrl("ordenes", view);
    scrollAdminContentToTop();
  }

  function toggleProductosNav() {
    if (!isProductosTab(tab)) {
      abrirVistaProductos("productos-crear");
      return;
    }
    setProductosNavOpen((prev) => !prev);
    scrollAdminContentToTop();
  }

  function toggleVentasNav() {
    if (tab !== "ordenes") {
      abrirVistaVentas("pedidos");
      return;
    }
    setVentasNavOpen((prev) => !prev);
    scrollAdminContentToTop();
  }

  const productos = productosQuery.data ?? [];
  const sabores = saboresQuery.data ?? [];
  const inventario = inventarioQuery.data ?? [];
  const movimientosStock = movimientosStockQuery.data ?? [];
  const postulaciones = postulacionesQuery.data ?? [];
  const ordenes = ordenesQuery.data ?? [];
  const usuarios = usuariosQuery.data ?? [];
  const movimientos = movimientosQuery.data ?? [];
  const todayStamp = getBuenosAiresDateStamp();
  const cumpleanosWindowEndStamp = useMemo(
    () => addMonthsToDateStamp(todayStamp, cumpleanosWindowMonths),
    [cumpleanosWindowMonths, todayStamp],
  );
  const cumpleanosCalculados = useMemo<UpcomingBirthday[]>(() => {
    return usuarios
      .filter((usuario) => usuario.activo && usuario.fecha_nacimiento)
      .map((usuario) => {
        const birthParts = parseDateOnlyParts(usuario.fecha_nacimiento ?? null);
        const todayParts = parseDateOnlyParts(todayStamp);
        if (!birthParts || !todayParts) return null;
        let nextYear = todayParts.year;
        let nextBirthdayStamp = getBirthdayOccurrenceStamp(birthParts.month, birthParts.day, nextYear);
        if (nextBirthdayStamp < todayStamp) {
          nextYear += 1;
          nextBirthdayStamp = getBirthdayOccurrenceStamp(birthParts.month, birthParts.day, nextYear);
        }
        return {
          usuario,
          birthDate: usuario.fecha_nacimiento ?? "",
          nextBirthdayStamp,
          daysUntil: diffDaysBetweenDateStamps(todayStamp, nextBirthdayStamp),
          isToday: nextBirthdayStamp === todayStamp,
          nextAge: nextYear - birthParts.year,
        } satisfies UpcomingBirthday;
      })
      .filter((value): value is UpcomingBirthday => Boolean(value))
      .sort((left, right) => (
        left.daysUntil - right.daysUntil
        || left.nextBirthdayStamp.localeCompare(right.nextBirthdayStamp)
        || left.usuario.nombre.localeCompare(right.usuario.nombre, "es")
      ));
  }, [todayStamp, usuarios]);
  const cumpleanosHoy = useMemo(
    () => cumpleanosCalculados.filter((item) => item.isToday),
    [cumpleanosCalculados],
  );
  const cumpleanosProximos = useMemo(
    () => cumpleanosCalculados.filter((item) => item.nextBirthdayStamp <= cumpleanosWindowEndStamp),
    [cumpleanosCalculados, cumpleanosWindowEndStamp],
  );
  const cumpleanosPorAvisar = useMemo(
    () => cumpleanosCalculados.filter((item) => item.daysUntil <= cumpleanosAlertDays),
    [cumpleanosAlertDays, cumpleanosCalculados],
  );
  const cumpleanosPorAvisarConWhatsapp = useMemo(
    () => cumpleanosPorAvisar.filter((item) => Boolean(normalizeWhatsAppPhone(item.usuario.telefono))),
    [cumpleanosPorAvisar],
  );
  const usuariosSinFechaNacimiento = useMemo(
    () => usuarios.filter((usuario) => usuario.activo && !usuario.fecha_nacimiento).length,
    [usuarios],
  );

  function guardarCumpleanosWindowMonths() {
    const rawValue = cumpleanosWindowMonthsDraft.trim();
    setErrMsg("");
    setOkMsg("");

    if (!rawValue) {
      setErrMsg("Completa cuántos meses quieres mostrar.");
      return;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      setErrMsg("Los próximos meses deben ser un número entero mayor o igual a 1.");
      return;
    }

    const nextValue = clampBirthdayWindowMonths(parsedValue);
    setCumpleanosWindowMonths(nextValue);
    setCumpleanosWindowMonthsDraft(String(nextValue));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ADMIN_BIRTHDAY_WINDOW_MONTHS_KEY, String(nextValue));
    }
    setOkMsg("Configuración de cumpleaños guardada.");
  }

  function guardarCumpleanosAlertDays() {
    const rawValue = cumpleanosAlertDaysDraft.trim();
    setErrMsg("");
    setOkMsg("");

    if (!rawValue) {
      setErrMsg("Completa cuántos días antes quieres avisar.");
      return;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      setErrMsg("Los días de aviso deben ser un número entero mayor o igual a 1.");
      return;
    }

    const nextValue = clampBirthdayAlertDays(parsedValue);
    setCumpleanosAlertDays(nextValue);
    setCumpleanosAlertDaysDraft(String(nextValue));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ADMIN_BIRTHDAY_ALERT_DAYS_KEY, String(nextValue));
    }
    setOkMsg("Aviso de cumpleaños guardado.");
  }

  function guardarCumpleanosConfig() {
    const rawMonths = cumpleanosWindowMonthsDraft.trim();
    const rawDays = cumpleanosAlertDaysDraft.trim();
    setErrMsg("");
    setOkMsg("");

    if (!rawMonths) {
      setErrMsg("Completa cuántos meses quieres mostrar.");
      return;
    }

    if (!rawDays) {
      setErrMsg("Completa cuántos días antes quieres avisar.");
      return;
    }

    const parsedMonths = Number(rawMonths);
    if (!Number.isInteger(parsedMonths) || parsedMonths < 1) {
      setErrMsg("Los próximos meses deben ser un número entero mayor o igual a 1.");
      return;
    }

    const parsedDays = Number(rawDays);
    if (!Number.isInteger(parsedDays) || parsedDays < 1) {
      setErrMsg("Los días de aviso deben ser un número entero mayor o igual a 1.");
      return;
    }

    const nextMonths = clampBirthdayWindowMonths(parsedMonths);
    const nextDays = clampBirthdayAlertDays(parsedDays);
    setCumpleanosWindowMonths(nextMonths);
    setCumpleanosWindowMonthsDraft(String(nextMonths));
    setCumpleanosAlertDays(nextDays);
    setCumpleanosAlertDaysDraft(String(nextDays));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ADMIN_BIRTHDAY_WINDOW_MONTHS_KEY, String(nextMonths));
      window.localStorage.setItem(ADMIN_BIRTHDAY_ALERT_DAYS_KEY, String(nextDays));
    }
    setOkMsg("Configuración de cumpleaños guardada.");
  }

  const categorias = categoriasQuery.data ?? [];
  const categoriasActivas = useMemo(() => categorias.filter((categoria) => categoria.activo !== false), [categorias]);
  const productosDescuentoUnitario = useMemo(
    () =>
      productos
        .filter((producto) =>
          producto.activo !== false &&
          (producto.tipo_producto === "venta" || producto.tipo_producto === "mixto") &&
          Number(producto.precio_dinero ?? producto.precio_dinero_original ?? 0) > 0
        )
        .sort((left, right) => left.nombre.localeCompare(right.nombre, "es")),
    [productos],
  );
  const categoriasProductoEdit = useMemo(() => {
    if (!editDraft.categoria) return categoriasActivas;
    const current = categorias.find((categoria) => categoria.nombre === editDraft.categoria);
    if (!current || current.activo !== false) return categoriasActivas;
    return [...categoriasActivas, current];
  }, [categorias, categoriasActivas, editDraft.categoria]);
  const descuentosCategorias = descuentosCategoriasQuery.data ?? [];
  const descuentosProductos = descuentosProductosQuery.data ?? [];
  const codigos = codigosQuery.data ?? [];
  const canjes = canjesQuery.data ?? [];
  const sucursales = sucursalesQuery.data ?? [];
  const proveedores = proveedoresQuery.data ?? [];
  const costosCobro = costosCobroQuery.data ?? [];
  const cajaActual = cajaActualQuery.data ?? null;
  const cajaSesionesData = cajaSesionesQuery.data ?? null;
  const cajaSesiones = cajaSesionesData?.items ?? [];
  const cajaSesionesTotalPages = cajaSesionesData?.totalPages ?? 1;
  const gastos = gastosQuery.data ?? [];
  const browserAlertsSupported = browserNotificationPermission !== "unsupported";
  const securityEvents = securityMonitorQuery.data?.persistidos ?? [];
  const appPresenceOverview = appPresenceOverviewQuery.data ?? null;
  const appPresenceSummary = appPresenceOverview?.summary ?? null;
  const activePresenceData = appPresenceOverview?.active_sessions ?? {
    items: [],
    total: 0,
    page: 1,
    pageSize: APP_PRESENCE_PAGE_SIZE,
    totalPages: 1,
  };
  const recentPresenceData = appPresenceOverview?.recent_logs ?? {
    items: [],
    total: 0,
    page: 1,
    pageSize: APP_PRESENCE_PAGE_SIZE,
    totalPages: 1,
  };
  const activePresenceSessions = activePresenceData.items;
  const recentPresenceLogs = recentPresenceData.items;
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
    if (cajaEditSesion || !cajaActual) return;
    setCajaMontoApertura(emptyZeroInputValue(cajaActual.monto_apertura));
    setCajaMontoCierre(emptyZeroInputValue(cajaActual.summary.efectivoSistema ?? cajaActual.monto_apertura));
    setCajaObservacionesApertura(cajaActual.observaciones_apertura ?? "");
    setCajaObservacionesCierre(cajaActual.observaciones_cierre ?? "");
  }, [cajaActual?.id, cajaEditSesion]);

  const inventarioPorProducto = useMemo(() => {
    const map = new Map<number, InventarioSucursal[]>();
    for (const row of inventario) {
      const current = map.get(Number(row.producto_id)) ?? [];
      current.push(row);
      map.set(Number(row.producto_id), current);
    }
    return map;
  }, [inventario]);
  const clientesVentaLocal = useMemo(
    () => usuarios.filter((usuario) => usuario.rol === "cliente" && usuario.activo),
    [usuarios],
  );
  const clienteVentaLocalSeleccionado = useMemo(
    () => clientesVentaLocal.find((usuario) => String(usuario.id) === ventaLocalClienteId) ?? null,
    [clientesVentaLocal, ventaLocalClienteId],
  );
  const descuentosCategoriasMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of descuentosCategorias) {
      const descuento = Number(item.descuento_porcentaje ?? 0);
      if (!item.activo || !Number.isFinite(descuento) || descuento <= 0) continue;
      map.set(discountDraftKey(item.tipo_cliente, item.categoria), Math.max(0, Math.min(100, descuento)));
    }
    return map;
  }, [descuentosCategorias]);
  const descuentosProductosMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of descuentosProductos) {
      const descuento = Number(item.descuento_porcentaje ?? 0);
      if (!item.activo || !Number.isFinite(descuento) || descuento <= 0) continue;
      map.set(productDiscountDraftKey(item.tipo_cliente, Number(item.producto_id)), Math.max(0, Math.min(100, descuento)));
    }
    return map;
  }, [descuentosProductos]);
  const productosVentaLocal = useMemo(
    () =>
      productos.filter((producto) =>
        producto.activo &&
        (producto.tipo_producto === "venta" || producto.tipo_producto === "mixto") &&
        Number(producto.precio_dinero ?? 0) > 0
      ).map((producto) => {
        const tipoClientePrecio = clienteVentaLocalSeleccionado?.tipo_cliente ?? "cliente";
        const descuentoCategoria = descuentosCategoriasMap.get(discountDraftKey(tipoClientePrecio, producto.categoria ?? "")) ?? 0;
        const descuentoProducto = descuentosProductosMap.get(productDiscountDraftKey(tipoClientePrecio, Number(producto.id))) ?? 0;
        const descuento = Math.max(descuentoCategoria, descuentoProducto);
        const precioBase = Number(producto.precio_dinero ?? 0);
        const precioFinal = Math.round((precioBase * (1 - descuento / 100) + Number.EPSILON) * 100) / 100;
        return {
          ...producto,
          precio_dinero_original: precioBase,
          precio_dinero: precioFinal,
          descuento_porcentaje_aplicado: descuento,
        };
      }),
    [clienteVentaLocalSeleccionado?.tipo_cliente, descuentosCategoriasMap, descuentosProductosMap, productos],
  );
  const productoVentaLocalSeleccionado = useMemo(
    () => productosVentaLocal.find((producto) => Number(producto.id) === Number(ventaLocalProductoId)) ?? null,
    [productosVentaLocal, ventaLocalProductoId],
  );
  const saboresVentaLocalProducto = useMemo(() => {
    if (!productoVentaLocalSeleccionado || productoVentaLocalSeleccionado.configuracion_tipo !== "caja_sabores") return [];
    const ids = new Set(
      (productoVentaLocalSeleccionado.sabor_ids?.length
        ? productoVentaLocalSeleccionado.sabor_ids
        : productoVentaLocalSeleccionado.sabores?.map((sabor) => sabor.id) ?? []
      ).map(Number),
    );
    return sabores.filter((sabor) => sabor.activo && ids.has(Number(sabor.id)));
  }, [productoVentaLocalSeleccionado, sabores]);
  const totalSaboresVentaLocal = useMemo(
    () => Object.values(ventaLocalSabores).reduce((acc, value) => acc + (Number(value) || 0), 0),
    [ventaLocalSabores],
  );
  const cantidadVentaLocalSeleccionada = useMemo(() => {
    const value = Math.floor(Number(ventaLocalCantidad));
    return Number.isInteger(value) && value > 0 ? value : 0;
  }, [ventaLocalCantidad]);
  const totalAlfajoresVentaLocal = useMemo(() => {
    const capacidad = Number(productoVentaLocalSeleccionado?.capacidad_sabores ?? 0);
    return Math.max(0, capacidad * cantidadVentaLocalSeleccionada);
  }, [cantidadVentaLocalSeleccionada, productoVentaLocalSeleccionado?.capacidad_sabores]);
  const totalVentaLocal = useMemo(
    () => ventaLocalItems.reduce((acc, item) => acc + item.precio_dinero * item.cantidad, 0),
    [ventaLocalItems],
  );
  const puntosVentaLocalEstimados = useMemo(
    () => calculatePointsByAmount(totalVentaLocal, configDraft.puntos_monto_base, configDraft.puntos_por_monto),
    [configDraft.puntos_monto_base, configDraft.puntos_por_monto, totalVentaLocal],
  );
  const productosVentaLocalFiltrados = useMemo(() => {
    const q = ventaLocalProductoBusqueda.trim().toLowerCase();
    if (!q) return productosVentaLocal;
    return productosVentaLocal.filter((producto) => [
      producto.nombre,
      producto.categoria ?? "",
      producto.descripcion ?? "",
      producto.sku ?? "",
    ].some((value) => value.toLowerCase().includes(q)));
  }, [productosVentaLocal, ventaLocalProductoBusqueda]);

  function getMaxSaborVentaLocal(saborId: number): number {
    const actual = Number(ventaLocalSabores[String(saborId)] ?? 0) || 0;
    return Math.max(0, totalAlfajoresVentaLocal - (totalSaboresVentaLocal - actual));
  }

  function upsertVentaLocalItemDraft(nextItem: VentaLocalItemDraft) {
    setVentaLocalItems((prev) => {
      const nextSabores = normalizeVentaLocalDraftSabores(nextItem.sabores);
      const existingIndex = prev.findIndex((item) => (
        Number(item.producto_id) === Number(nextItem.producto_id)
        && sameVentaLocalDraftSabores(item.sabores, nextSabores)
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

  function getVentaLocalProductoCantidad(productId: number): number {
    return ventaLocalItems
      .filter((item) => Number(item.producto_id) === Number(productId) && !item.sabores?.length)
      .reduce((acc, item) => acc + item.cantidad, 0);
  }

  function prepararProductoVentaLocalConSabores(producto: typeof productosVentaLocal[number]) {
    setErrMsg("");
    setOkMsg("");
    setVentaLocalProductoId(String(producto.id));
    setVentaLocalCantidad("1");
    setVentaLocalSabores({});
  }

  function cambiarCantidadProductoVentaLocal(producto: typeof productosVentaLocal[number], delta: number) {
    setErrMsg("");
    setOkMsg("");
    if (producto.configuracion_tipo === "caja_sabores") {
      prepararProductoVentaLocalConSabores(producto);
      return;
    }
    if (delta < 0) {
      setVentaLocalItems((prev) => {
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
    upsertVentaLocalItemDraft({
      producto_id: Number(producto.id),
      nombre: producto.nombre,
      cantidad: delta,
      precio_dinero: Number(producto.precio_dinero ?? 0),
      sabores: [],
    });
    resetVentaLocalProductoDraft();
  }

  function cambiarCantidadVentaLocalItem(index: number, delta: number) {
    setVentaLocalItems((prev) => prev.flatMap((item, itemIndex) => {
      if (itemIndex !== index) return [item];
      if (item.sabores?.length) return [item];
      const nextCantidad = item.cantidad + delta;
      if (nextCantidad <= 0) return [];
      return [{ ...item, cantidad: nextCantidad }];
    }));
  }

  function updateSaborVentaLocal(saborId: number, rawValue: string) {
    const max = getMaxSaborVentaLocal(saborId);
    if (rawValue === "") {
      setVentaLocalSabores((prev) => ({
        ...prev,
        [String(saborId)]: "",
      }));
      return;
    }

    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) return;

    const value = Math.floor(numericValue);
    setVentaLocalSabores((prev) => ({
      ...prev,
      [String(saborId)]: String(Math.min(max, Math.max(0, value))),
    }));
  }

  async function enableBrowserAlerts() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setBrowserNotificationPermission("unsupported");
      setAdminHint("Este navegador no soporta alertas push del panel.");
      return;
    }

    const permission = await window.Notification.requestPermission();
    setBrowserNotificationPermission(permission);
    if (permission === "granted") {
      setAdminHint("Alertas del navegador activadas para compras y canjes nuevos.");
      return;
    }
    setAdminHint("No se activaron las alertas del navegador.");
  }

  function showBrowserAlert(title: string, body: string) {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;
    new window.Notification(title, { body });
  }

  function openOrderFromToast(orderId: number) {
    setBusquedaOrdenes("");
    setOrdenesFiltroEstado("");
    setOrdenesFiltroEntrega("");
    setOrdenesPage(1);
    setOrdenExpandidaId(orderId);
    abrirVistaVentas("pedidos");
  }

  function openRedeemsFromToast() {
    seleccionarTab("canjes");
  }

  useEffect(() => {
    if (!canjesQuery.data) return;
    const currentIds = canjes.map((canje) => Number(canje.id));
    const knownIds = readStoredIds(ADMIN_ALERT_REDEEM_IDS_KEY);
    if (!hasStoredIds(ADMIN_ALERT_REDEEM_IDS_KEY)) {
      writeStoredIds(ADMIN_ALERT_REDEEM_IDS_KEY, currentIds);
      return;
    }

    const knownSet = new Set(knownIds);
    const nuevos = canjes.filter((canje) => !knownSet.has(Number(canje.id)));
    if (!nuevos.length) return;

    writeStoredIds(ADMIN_ALERT_REDEEM_IDS_KEY, [...currentIds, ...knownIds]);
    if (tab !== "canjes") {
      setAdminAlerts((prev) => ({ ...prev, canjes: prev.canjes + nuevos.length }));
    }

    const latest = nuevos[0];
    showToast({
      tone: "success",
      title: nuevos.length === 1 ? `Nuevo canje #${latest.id}` : `${nuevos.length} canjes nuevos`,
      message: nuevos.length === 1
        ? `${latest.cliente_nombre} hizo un canje. Toca para verlo.`
        : "Toca para revisar los canjes.",
      actionLabel: "Ver canjes",
      onClick: openRedeemsFromToast,
      onAction: openRedeemsFromToast,
      duration: 8500,
    });
    showBrowserAlert(
      nuevos.length === 1 ? "Nuevo canje" : "Nuevos canjes",
      nuevos.length === 1
        ? `${latest.cliente_nombre} hizo el canje #${latest.id}.`
        : `Tienes ${nuevos.length} canjes nuevos en el panel.`,
    );
  }, [canjes, canjesQuery.data, tab, showToast]);

  useEffect(() => {
    if (tab === "ordenes" && adminAlerts.ordenes > 0) {
      setAdminAlerts((prev) => ({ ...prev, ordenes: 0 }));
    }
  }, [adminAlerts.ordenes, tab]);

  useEffect(() => {
    if (tab === "canjes" && adminAlerts.canjes > 0) {
      setAdminAlerts((prev) => ({ ...prev, canjes: 0 }));
    }
  }, [adminAlerts.canjes, tab]);

  useEffect(() => {
    if (tab === "arrepentimiento" && adminAlerts.arrepentimiento > 0) {
      setAdminAlerts((prev) => ({ ...prev, arrepentimiento: 0 }));
    }
  }, [adminAlerts.arrepentimiento, tab]);

  useEffect(() => {
    if (statsQuery.data) {
      setAdminAlerts((prev) => ({
        ...prev,
        arrepentimiento: statsQuery.data.arrepentimientos_pendientes ?? 0,
      }));
    }
  }, [statsQuery.data]);

  useEffect(() => {
    if (!cumpleanosPorAvisarConWhatsapp.length) return;
    if (typeof window === "undefined") return;
    const alreadyShownForDay = window.localStorage.getItem(ADMIN_BIRTHDAY_TOAST_DAY_KEY);
    if (alreadyShownForDay === todayStamp) return;
    window.localStorage.setItem(ADMIN_BIRTHDAY_TOAST_DAY_KEY, todayStamp);
    const nextBirthday = cumpleanosPorAvisarConWhatsapp[0];
    showToast({
      tone: "info",
      title: cumpleanosPorAvisarConWhatsapp.length === 1 ? "Cumpleaños por avisar" : "Cumpleaños por avisar",
      message: cumpleanosPorAvisarConWhatsapp.length === 1
        ? `${nextBirthday?.usuario.nombre} cumple ${formatBirthdayCountdownPhrase(nextBirthday?.daysUntil ?? 0)}.`
        : `${nextBirthday?.usuario.nombre} cumple ${formatBirthdayCountdownPhrase(nextBirthday?.daysUntil ?? 0)}. Hay ${cumpleanosPorAvisarConWhatsapp.length} clientes para avisar.`,
      actionLabel: "Ver cumpleaños",
      onAction: () => navigate(`${panelBasePath}/cumpleanos`),
      duration: 9500,
    });
  }, [cumpleanosPorAvisarConWhatsapp, navigate, panelBasePath, showToast, todayStamp]);

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
    return productos.filter((producto) => {
      if (filtroTipoProducto && producto.tipo_producto !== filtroTipoProducto) return false;
      if (!q) return true;
      const haystack = [
        producto.nombre,
        producto.sku || "",
        producto.tipo_producto || "",
        producto.descripcion || "",
        producto.categoria || "",
        String(producto.puntos_requeridos),
        String(producto.precio_dinero ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [productos, busquedaProductos, filtroTipoProducto]);

  const inventarioFiltrado = useMemo(() => {
    const q = busquedaInventario.trim().toLowerCase();
    return inventario.filter((row) => {
      const sucursalOk = !inventarioFiltroSucursal || Number(row.sucursal_id) === Number(inventarioFiltroSucursal);
      const productoOk = !inventarioFiltroProducto || Number(row.producto_id) === Number(inventarioFiltroProducto);
      if (!sucursalOk || !productoOk) return false;
      if (!q) return true;
      const haystack = [
        row.producto_nombre,
        row.sku || "",
        row.tipo_producto,
        row.sucursal_nombre,
        String(row.stock_disponible),
        String(row.stock_reservado),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [busquedaInventario, inventario, inventarioFiltroProducto, inventarioFiltroSucursal]);

  const postulacionesFiltradas = useMemo(() => {
    const q = busquedaPostulaciones.trim().toLowerCase();
    if (!q) return postulaciones;
    return postulaciones.filter((postulacion) => {
      const haystack = [
        postulacion.nombre,
        postulacion.email,
        postulacion.telefono || "",
        postulacion.mensaje,
        postulacion.archivo_original,
        postulacion.estado,
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [busquedaPostulaciones, postulaciones]);

  const ordenesFiltradas = useMemo(() => {
    const q = busquedaOrdenes.trim().toLowerCase();
    return ordenes.filter((orden) => {
      if (ordenesFiltroEstado && orden.estado !== ordenesFiltroEstado) return false;
      if (ordenesFiltroEntrega === "envio" && !orden.direccion_envio) return false;
      if (ordenesFiltroEntrega === "retiro" && orden.direccion_envio) return false;
      if (!q) return true;
      const haystack = [
        String(orden.id),
        orden.cliente_nombre,
        orden.cliente_email,
        orden.canal,
        orden.estado,
        orden.tipo_orden,
        orden.sucursal_nombre || "",
        orden.direccion_envio?.direccion || "",
        orden.direccion_envio?.codigo_postal || "",
        orden.direccion_envio?.localidad || "",
        orden.pago?.estado || "",
        orden.pago?.proveedor || "",
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [busquedaOrdenes, ordenes, ordenesFiltroEntrega, ordenesFiltroEstado]);

  const totalUsuariosPages = Math.max(1, Math.ceil(usuariosFiltrados.length / LISTA_POR_PAGINA));
  const totalCumpleanosPages = Math.max(1, Math.ceil(cumpleanosProximos.length / CUMPLEANOS_POR_PAGINA));
  const totalProductosPages = Math.max(1, Math.ceil(productosFiltrados.length / LISTA_POR_PAGINA));
  const totalInventarioPages = Math.max(1, Math.ceil(inventarioFiltrado.length / LISTA_POR_PAGINA));
  const totalPostulacionesPages = Math.max(1, Math.ceil(postulacionesFiltradas.length / LISTA_POR_PAGINA));
  const totalOrdenesPages = Math.max(1, Math.ceil(ordenesFiltradas.length / LISTA_POR_PAGINA));
  const totalCategoriasPages = Math.max(1, Math.ceil(categorias.length / LISTA_POR_PAGINA));
  const totalTransaccionesPages = Math.max(1, Math.ceil(movimientos.length / LISTA_POR_PAGINA));
  const totalCanjesPages = Math.max(1, Math.ceil(canjes.length / LISTA_POR_PAGINA));
  const totalCodigosPages = Math.max(1, Math.ceil(codigos.length / LISTA_POR_PAGINA));
  const totalSucursalesPages = Math.max(1, Math.ceil(sucursales.length / LISTA_POR_PAGINA));
  const totalAppPresenceActivePages = activePresenceData.totalPages;
  const totalAppPresenceRecentPages = recentPresenceData.totalPages;

  useEffect(() => {
    setUsuariosPage((prev) => Math.min(prev, totalUsuariosPages));
  }, [totalUsuariosPages]);

  useEffect(() => {
    setCumpleanosPage((prev) => Math.min(prev, totalCumpleanosPages));
  }, [totalCumpleanosPages]);

  useEffect(() => {
    setCumpleanosPage(1);
  }, [cumpleanosWindowMonths]);

  useEffect(() => {
    setProductosPage((prev) => Math.min(prev, totalProductosPages));
  }, [totalProductosPages]);

  useEffect(() => {
    setInventarioPage((prev) => Math.min(prev, totalInventarioPages));
  }, [totalInventarioPages]);

  useEffect(() => {
    setPostulacionesPage((prev) => Math.min(prev, totalPostulacionesPages));
  }, [totalPostulacionesPages]);

  useEffect(() => {
    setOrdenesPage((prev) => Math.min(prev, totalOrdenesPages));
  }, [totalOrdenesPages]);

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

  useEffect(() => {
    setAppPresenceActivePage((prev) => Math.min(prev, totalAppPresenceActivePages));
  }, [totalAppPresenceActivePages]);

  useEffect(() => {
    setAppPresenceRecentPage((prev) => Math.min(prev, totalAppPresenceRecentPages));
  }, [totalAppPresenceRecentPages]);

  const blockedAccessEventsPagina = useMemo(() => {
    const start = (seguridadPage - 1) * INTENTOS_SEGURIDAD_POR_PAGINA;
    return blockedAccessEvents.slice(start, start + INTENTOS_SEGURIDAD_POR_PAGINA);
  }, [blockedAccessEvents, seguridadPage]);


  const usuariosPagina = useMemo(() => {
    const start = (usuariosPage - 1) * LISTA_POR_PAGINA;
    return usuariosFiltrados.slice(start, start + LISTA_POR_PAGINA);
  }, [usuariosFiltrados, usuariosPage]);

  const cumpleanosPagina = useMemo(() => {
    const start = (cumpleanosPage - 1) * CUMPLEANOS_POR_PAGINA;
    return cumpleanosProximos.slice(start, start + CUMPLEANOS_POR_PAGINA);
  }, [cumpleanosPage, cumpleanosProximos]);
  const cumpleanosPageStart = cumpleanosProximos.length === 0 ? 0 : (cumpleanosPage - 1) * CUMPLEANOS_POR_PAGINA + 1;
  const cumpleanosPageEnd = Math.min(cumpleanosPage * CUMPLEANOS_POR_PAGINA, cumpleanosProximos.length);

  const productosPagina = useMemo(() => {
    const start = (productosPage - 1) * LISTA_POR_PAGINA;
    return productosFiltrados.slice(start, start + LISTA_POR_PAGINA);
  }, [productosFiltrados, productosPage]);

  const inventarioPagina = useMemo(() => {
    const start = (inventarioPage - 1) * LISTA_POR_PAGINA;
    return inventarioFiltrado.slice(start, start + LISTA_POR_PAGINA);
  }, [inventarioFiltrado, inventarioPage]);

  const postulacionesPagina = useMemo(() => {
    const start = (postulacionesPage - 1) * LISTA_POR_PAGINA;
    return postulacionesFiltradas.slice(start, start + LISTA_POR_PAGINA);
  }, [postulacionesFiltradas, postulacionesPage]);

  const ordenesPagina = useMemo(() => {
    const start = (ordenesPage - 1) * LISTA_POR_PAGINA;
    return ordenesFiltradas.slice(start, start + LISTA_POR_PAGINA);
  }, [ordenesFiltradas, ordenesPage]);

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

  const terminosHtml = useMemo(() => renderSafeMarkdown(stripPageImages(terminosDraft.contenido || "")), [terminosDraft.contenido]);
  const politicaPrivacidadHtml = useMemo(
    () => renderSafeMarkdown(stripPageImages(politicaPrivacidadDraft.contenido || "")),
    [politicaPrivacidadDraft.contenido],
  );
  const arrepentimientoItems = arrepentimientoQuery.data?.items ?? [];
  const arrepentimientoTotalPages = arrepentimientoQuery.data?.totalPages ?? 1;

  async function subirImagenProducto(file: File, target: "nuevo" | "edit") {
    if (!file) return;
    if (!isAllowedImageFile(file)) {
      setErrMsg("Solo puedes subir imagenes JPG, PNG o WEBP.");
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
      setErrMsg(
        error instanceof Error
          ? error.message
          : "No se pudo procesar la imagen en el servidor. Intenta con otra imagen o revisa el tamaño (máx 5MB).",
      );
    } finally {
      setBusy(false);
    }
  }

  async function subirImagenCategoria(file: File, target: "nuevo" | "edit") {
    if (!file) return;
    if (!isAllowedImageFile(file)) {
      setErrMsg("Solo puedes subir imagenes JPG, PNG o WEBP.");
      return;
    }
    setBusy(true);
    setErrMsg("");
    try {
      const upload = await uploadImageMutation.mutateAsync(file);
      if (target === "nuevo") {
        setNuevaCategoria((prev) => ({ ...prev, imagen_url: upload.url }));
      } else {
        setCategoriaEditDraft((prev) => ({ ...prev, imagen_url: upload.url }));
      }
      setAdminHint("Imagen cargada con exito.");
    } catch (error) {
      setErrMsg(

        formatActionError(
          "subir la imagen",
          error,
          "Si estabas en desarrollo, confirma que el backend responda en http://localhost:4000 y que la imagen no haya sido bloqueada por tamaño o formato."
        )
      );
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
    const accepted = files.filter(isAllowedImageFile).slice(0, slotsAvailable);
    if (!accepted.length) {
      setErrMsg(`Arrastra imagenes JPG, PNG o WEBP. Maximo ${MAX_PRODUCT_IMAGES} por producto.`);
      return;
    }

    for (const file of accepted) {
      // Subida secuencial para mantener el orden de las imágenes.
      // eslint-disable-next-line no-await-in-loop
      await subirImagenProducto(file, target);
    }
  }

  async function subirImagenMobileProducto(file: File, target: "nuevo" | "edit") {
    if (!file) return;
    if (!isAllowedImageFile(file)) {
      setErrMsg("Solo puedes subir imagenes JPG, PNG o WEBP.");
      return;
    }

    setBusy(true);
    setErrMsg("");
    try {
      const upload = await uploadImageMutation.mutateAsync(file);
      if (target === "nuevo") {
        setNuevoProducto((prev) => ({ ...prev, imagen_mobile_url: upload.url }));
      } else {
        setEditDraft((prev) => ({ ...prev, imagen_mobile_url: upload.url }));
      }
      setAdminHint("Imagen móvil cargada con exito.");
    } catch (error) {
      setErrMsg(
        error instanceof Error
          ? error.message
          : "No se pudo procesar la imagen en el servidor."
      );
    } finally {
      setBusy(false);
    }
  }

  function quitarImagenMobileProducto(target: "nuevo" | "edit") {
    if (target === "nuevo") {
      setNuevoProducto((prev) => ({ ...prev, imagen_mobile_url: "" }));
      return;
    }
    setEditDraft((prev) => ({ ...prev, imagen_mobile_url: "" }));
  }

  function quitarImagenProducto(target: "nuevo" | "edit", index: number) {
    if (target === "nuevo") {
      setNuevoProducto((prev) => ({ ...prev, imagenes: prev.imagenes.filter((_, idx) => idx !== index) }));
      return;
    }
    setEditDraft((prev) => ({ ...prev, imagenes: prev.imagenes.filter((_, idx) => idx !== index) }));
  }

  function toggleSaborProducto(target: "nuevo" | "edit", saborId: number) {
    const update = (prev: ProductoForm): ProductoForm => {
      const exists = prev.sabor_ids.includes(saborId);
      return {
        ...prev,
        sabor_ids: exists ? prev.sabor_ids.filter((id) => id !== saborId) : [...prev.sabor_ids, saborId],
      };
    };
    if (target === "nuevo") setNuevoProducto(update);
    else setEditDraft(update);
  }

  async function crearSabor() {
    setErrMsg("");
    setOkMsg("");
    if (!nuevoSabor.nombre.trim()) {
      setErrMsg("El nombre del sabor es obligatorio.");
      return;
    }
    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/sabores",
        body: {
          nombre: nuevoSabor.nombre.trim(),
          descripcion: nuevoSabor.descripcion.trim() || null,
          activo: true,
          inventario_sucursales: stockDraftPayload(nuevoSabor.inventario_sucursales, sucursales),
        },
      });
      setNuevoSabor({ nombre: "", descripcion: "", inventario_sucursales: {} });
      setOkMsg("Sabor creado correctamente.");
      await refreshQueries([["admin", "sabores"], ["productos"]]);
    } catch (error) {
      setErrMsg(formatActionError("crear el sabor", error));
    } finally {
      setBusy(false);
    }
  }

  async function actualizarStockSabor(sabor: SaborAdmin, sucursalId: number, stock: number) {
    const draft = flavorInventoryDraftFromRows(sabor.inventario_sucursales, sucursales);
    draft[String(sucursalId)] = Math.max(0, Number(stock) || 0);
    try {
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/sabores/${sabor.id}`,
        body: {
          nombre: sabor.nombre,
          descripcion: sabor.descripcion ?? null,
          activo: sabor.activo,
          inventario_sucursales: stockDraftPayload(draft, sucursales),
        },
      });
      await refreshQueries([["admin", "sabores"], ["productos"]]);
    } catch (error) {
      setErrMsg(formatActionError("actualizar el stock del sabor", error));
    }
  }

  async function toggleSaborActivo(sabor: SaborAdmin) {
    setErrMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/sabores/${sabor.id}/activo`,
        body: { activo: !sabor.activo },
      });
      await refreshQueries([["admin", "sabores"], ["admin", "productos"], ["productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    }
  }

  async function crearProducto() {
    setErrMsg("");
    setOkMsg("");
    if (!nuevoProducto.nombre.trim()) {
      setErrMsg("El nombre del producto es obligatorio.");
      return;
    }

    if ((nuevoProducto.tipo_producto === "canje" || nuevoProducto.tipo_producto === "mixto") && (!nuevoProducto.puntos_requeridos || nuevoProducto.puntos_requeridos <= 0)) {
      setErrMsg("Los puntos para canjear deben ser mayores a 0.");
      return;
    }

    if ((nuevoProducto.tipo_producto === "venta" || nuevoProducto.tipo_producto === "mixto") && (!nuevoProducto.precio_dinero || nuevoProducto.precio_dinero <= 0)) {
      setErrMsg("El precio de venta debe ser mayor a 0.");
      return;
    }
    if (nuevoProducto.configuracion_tipo === "caja_sabores") {
      if (!nuevoProducto.capacidad_sabores || nuevoProducto.capacidad_sabores <= 0) {
        setErrMsg("Indica cuantos alfajores trae la caja.");
        return;
      }
      if (!nuevoProducto.sabor_ids.length) {
        setErrMsg("Selecciona al menos un sabor para la caja.");
        return;
      }
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
          sku: nuevoProducto.sku.trim() || null,
          descripcion: nuevoProducto.descripcion || null,
          categoria: nuevoProducto.categoria || null,
          tipo_producto: nuevoProducto.tipo_producto,
          configuracion_tipo: nuevoProducto.configuracion_tipo,
          capacidad_sabores: nuevoProducto.configuracion_tipo === "caja_sabores" ? Number(nuevoProducto.capacidad_sabores) : null,
          sabor_ids: nuevoProducto.configuracion_tipo === "caja_sabores" ? nuevoProducto.sabor_ids : [],
          precio_dinero: nuevoProducto.tipo_producto === "venta" || nuevoProducto.tipo_producto === "mixto" ? Number(nuevoProducto.precio_dinero) : null,
          puntos_requeridos: Number(nuevoProducto.puntos_requeridos),
          puntos_para_canjear: nuevoProducto.tipo_producto === "canje" || nuevoProducto.tipo_producto === "mixto" ? Number(nuevoProducto.puntos_requeridos) : null,
          destacado_home: nuevoProducto.destacado_home,
          track_stock: nuevoProducto.configuracion_tipo === "caja_sabores" ? false : nuevoProducto.track_stock,
          permite_envio: nuevoProducto.permite_envio,
          envio_gratis: nuevoProducto.permite_envio && nuevoProducto.envio_gratis,
          permite_retiro_local: nuevoProducto.permite_retiro_local,
          inventario_sucursales: productoInventoryPayload(nuevoProducto, sucursales),
          imagenes,
          imagen_url: imagenUrl,
          imagen_mobile_url: nuevoProducto.imagen_mobile_url || null,
        },
      });

      setNuevoProducto(emptyProductoForm());
      setOkMsg("Producto creado correctamente.");
      await refreshQueries([["admin", "productos"], ["admin", "inventario"], ["admin", "movimientos-stock"], ["admin", "stats"], ["productos"], ["home", "productos"]]);
    } catch (error) {
      setErrMsg(
        formatActionError(
          "crear el producto",
          error,
          "Revisa nombre, precios, puntos y que la API de admin esté disponible antes de volver a intentar."
        )
      );
    } finally {
      setBusy(false);
    }
  }

  function startEdit(producto: ProductoAdmin) {
    setEditId(producto.id);
    setEditDraft({
      nombre: producto.nombre,
      sku: producto.sku || "",
      descripcion: producto.descripcion || "",
      categoria: producto.categoria || "",
      tipo_producto: producto.tipo_producto ?? "canje",
      configuracion_tipo: producto.configuracion_tipo ?? "simple",
      capacidad_sabores: producto.capacidad_sabores ?? null,
      sabor_ids: producto.sabor_ids ?? producto.sabores?.map((sabor) => sabor.id) ?? [],
      precio_dinero: producto.precio_dinero === null || producto.precio_dinero === undefined ? null : Number(producto.precio_dinero),
      puntos_requeridos: producto.puntos_para_canjear ?? producto.precio_puntos ?? producto.puntos_requeridos,
      destacado_home: producto.destacado_home ?? false,
      track_stock: producto.track_stock ?? true,
      permite_envio: producto.permite_envio ?? false,
      envio_gratis: Boolean(producto.permite_envio && producto.envio_gratis),
      permite_retiro_local: producto.permite_retiro_local ?? true,
      inventario_sucursales: inventoryDraftFromRows(inventarioPorProducto.get(producto.id), sucursales),
      imagenes: normalizeImageList(producto.imagenes ?? (producto.imagen_url ? [producto.imagen_url] : [])),
      imagen_mobile_url: producto.imagen_mobile_url || "",
    });
  }

  async function saveEdit(productoId: number) {
    setErrMsg("");
    setOkMsg("");
    if ((editDraft.tipo_producto === "canje" || editDraft.tipo_producto === "mixto") && (!editDraft.puntos_requeridos || editDraft.puntos_requeridos <= 0)) {
      setErrMsg("Los puntos para canjear deben ser mayores a 0.");
      return;
    }
    if ((editDraft.tipo_producto === "venta" || editDraft.tipo_producto === "mixto") && (!editDraft.precio_dinero || editDraft.precio_dinero <= 0)) {
      setErrMsg("El precio de venta debe ser mayor a 0.");
      return;
    }
    if (editDraft.configuracion_tipo === "caja_sabores") {
      if (!editDraft.capacidad_sabores || editDraft.capacidad_sabores <= 0) {
        setErrMsg("Indica cuantos alfajores trae la caja.");
        return;
      }
      if (!editDraft.sabor_ids.length) {
        setErrMsg("Selecciona al menos un sabor para la caja.");
        return;
      }
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
          sku: editDraft.sku.trim() || null,
          descripcion: editDraft.descripcion || null,
          categoria: editDraft.categoria || null,
          tipo_producto: editDraft.tipo_producto,
          configuracion_tipo: editDraft.configuracion_tipo,
          capacidad_sabores: editDraft.configuracion_tipo === "caja_sabores" ? Number(editDraft.capacidad_sabores) : null,
          sabor_ids: editDraft.configuracion_tipo === "caja_sabores" ? editDraft.sabor_ids : [],
          precio_dinero: editDraft.tipo_producto === "venta" || editDraft.tipo_producto === "mixto" ? Number(editDraft.precio_dinero) : null,
          puntos_requeridos: Number(editDraft.puntos_requeridos),
          puntos_para_canjear: editDraft.tipo_producto === "canje" || editDraft.tipo_producto === "mixto" ? Number(editDraft.puntos_requeridos) : null,
          destacado_home: editDraft.destacado_home,
          track_stock: editDraft.configuracion_tipo === "caja_sabores" ? false : editDraft.track_stock,
          permite_envio: editDraft.permite_envio,
          envio_gratis: editDraft.permite_envio && editDraft.envio_gratis,
          permite_retiro_local: editDraft.permite_retiro_local,
          inventario_sucursales: productoInventoryPayload(editDraft, sucursales),
          imagenes,
          imagen_url: imagenUrl,
          imagen_mobile_url: editDraft.imagen_mobile_url || null,
        },
      });

      setEditId(null);
      setOkMsg("Producto actualizado.");
      await refreshQueries([["admin", "productos"], ["admin", "inventario"], ["admin", "movimientos-stock"], ["productos"], ["home", "productos"]]);
    } catch (error) {
      setErrMsg(
        formatActionError(
          "guardar el producto",
          error,
          "Si el error fue de red, verifica backend, proxy de Vite y permisos del origen actual."
        )
      );
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
      await refreshQueries([["admin", "productos"], ["admin", "stats"], ["productos"], ["home", "productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    }
  }

  async function guardarAjusteInventario(row: InventarioSucursal) {
    const key = `${row.producto_id}:${row.sucursal_id}`;
    const raw = inventarioDraft[key] ?? String(row.stock_disponible);
    const nuevoStock = Number(raw);
    if (!Number.isInteger(nuevoStock) || nuevoStock < 0) {
      setErrMsg("El stock disponible debe ser un entero mayor o igual a 0.");
      return;
    }

    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: "/admin/inventario/ajuste",
        body: {
          producto_id: row.producto_id,
          sucursal_id: row.sucursal_id,
          nuevo_stock_disponible: nuevoStock,
          descripcion: "Ajuste desde panel de inventario",
        },
      });
      setOkMsg("Inventario actualizado.");
      await refreshQueries([["admin", "inventario"], ["admin", "productos"], ["admin", "movimientos-stock"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function ajustarInventarioRapido(row: InventarioSucursal, delta: number) {
    const key = `${row.producto_id}:${row.sucursal_id}`;
    setInventarioDraft((prev) => {
      const actual = Number(prev[key] ?? row.stock_disponible);
      const base = Number.isFinite(actual) ? actual : Number(row.stock_disponible ?? 0);
      return { ...prev, [key]: String(Math.max(0, base + delta)) };
    });
  }

  async function actualizarEstadoOrden(id: number, estado: OrdenAdmin["estado"]) {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/ordenes/${id}`,
        body: { estado },
      });
      setOkMsg(`Orden #${id} actualizada a ${formatEstadoOrden(estado)}.`);
      await refreshQueries([["admin", "ordenes"], ["admin", "inventario"], ["admin", "movimientos-stock"], ["admin", "movimientos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function abrirCancelacionUrgente(orden: OrdenAdmin) {
    setErrMsg("");
    setOkMsg("");
    setCancelacionOrden({
      orden,
      motivo: "",
      mensaje_devolucion:
        "Si ya abonaste el pedido, por este mismo chat coordinamos la devolucion del dinero como ultima instancia.",
    });
  }

  async function confirmarCancelacionUrgente() {
    if (!cancelacionOrden) return;
    const motivo = cancelacionOrden.motivo.trim();
    if (motivo.length < 8) {
      setErrMsg("Escribe un motivo claro para informar al cliente.");
      return;
    }
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      const result = await commandMutation.mutateAsync({
        method: "post",
        path: `/admin/ordenes/${cancelacionOrden.orden.id}/cancelar`,
        body: {
          motivo,
          mensaje_devolucion: cancelacionOrden.mensaje_devolucion.trim() || undefined,
        },
      }) as { requiere_devolucion?: boolean; conversacion_id?: number | null };
      setOkMsg(
        result.requiere_devolucion
          ? `Orden #${cancelacionOrden.orden.id} cancelada. Se aviso al cliente y queda pendiente coordinar devolucion.`
          : `Orden #${cancelacionOrden.orden.id} cancelada y cliente notificado.`,
      );
      setCancelacionOrden(null);
      await refreshQueries([
        ["admin", "ordenes"],
        ["admin", "inventario"],
        ["admin", "movimientos-stock"],
        ["admin", "movimientos"],
        ["admin", "caja-actual"],
        ["admin", "caja-sesiones"],
      ]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function resetVentaLocalProductoDraft() {
    setVentaLocalProductoId("");
    setVentaLocalCantidad("1");
    setVentaLocalSabores({});
  }

  function resetVentaLocalForm() {
    setVentaLocalEditOrdenId(null);
    setVentaLocalItems([]);
    setVentaLocalClienteId("");
    setVentaLocalClienteManualNombre("");
    setVentaLocalClienteManualDni("");
    setVentaLocalMetodoPago("cash");
    setVentaLocalProductoBusqueda("");
    resetVentaLocalProductoDraft();
  }

  function cancelarEdicionVentaLocal() {
    resetVentaLocalForm();
    setOkMsg("");
    setErrMsg("");
  }

  async function cancelarVentaLocal(orden: OrdenAdmin) {
    if (!isOrdenVentaLocal(orden)) {
      setErrMsg("Solo se pueden cancelar ventas locales desde esta accion.");
      return;
    }
    const confirmed = window.confirm(`Cancelar la venta local #${orden.id}? Se devuelve stock y se descuenta de caja.`);
    if (!confirmed) return;
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "post",
        path: `/admin/ventas-locales/${orden.id}/cancelar`,
        body: { motivo: "Cancelacion desde listado de pedidos" },
      });
      if (ventaLocalEditOrdenId === orden.id) resetVentaLocalForm();
      setOkMsg(`Venta local #${orden.id} cancelada. Se ajustaron stock y caja.`);
      await refreshQueries([
        ["admin", "ordenes"],
        ["admin", "inventario"],
        ["admin", "movimientos-stock"],
        ["admin", "movimientos"],
        ["admin", "usuarios"],
        ["admin", "stats"],
        ["admin", "caja-actual", cajaSucursalId],
        ["admin", "caja-sesiones", cajaSucursalId],
      ]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function agregarItemVentaLocal() {
    setErrMsg("");
    const producto = productoVentaLocalSeleccionado;
    if (!producto) {
      setErrMsg("Selecciona un producto para agregar a la venta local.");
      return;
    }
    const cantidad = Number(ventaLocalCantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setErrMsg("La cantidad debe ser un numero entero mayor a 0.");
      return;
    }

    const saboresItem = producto.configuracion_tipo === "caja_sabores"
      ? saboresVentaLocalProducto
          .map((sabor) => ({
            sabor_id: sabor.id,
            nombre: sabor.nombre,
            cantidad: Number(ventaLocalSabores[String(sabor.id)] ?? 0) || 0,
          }))
          .filter((sabor) => sabor.cantidad > 0)
      : [];
    if (producto.configuracion_tipo === "caja_sabores") {
      const capacidad = Number(producto.capacidad_sabores ?? 0);
      const totalRequerido = capacidad * cantidad;
      if (totalSaboresVentaLocal !== totalRequerido) {
        setErrMsg(`Selecciona exactamente ${totalRequerido} alfajores para ${cantidad} caja${cantidad === 1 ? "" : "s"} de ${producto.nombre}.`);
        return;
      }
    }

    upsertVentaLocalItemDraft({
      producto_id: producto.id,
      nombre: producto.nombre,
      cantidad,
      precio_dinero: Number(producto.precio_dinero ?? 0),
      sabores: saboresItem,
    });
    resetVentaLocalProductoDraft();
  }

  async function registrarVentaLocal() {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!ventaLocalSucursalId) throw new Error("Selecciona una sucursal para la venta local.");
      if (!ventaLocalItems.length) throw new Error("Agrega al menos un producto a la venta local.");
      const hasManualCustomer = Boolean(
        ventaLocalClienteManualNombre.trim() ||
        ventaLocalClienteManualDni.trim(),
      );
      if (!ventaLocalClienteId && hasManualCustomer) {
        if (!ventaLocalClienteManualNombre.trim()) {
          throw new Error("Para cliente manual completa al menos el nombre, o deja los campos vacios para usar Cliente generico.");
        }
        if (ventaLocalClienteManualDni.trim() && !validateManualDni(ventaLocalClienteManualDni)) {
          throw new Error("El DNI del cliente manual debe tener solo numeros y entre 6 y 10 digitos.");
        }
      }

      const result = await commandMutation.mutateAsync({
        method: ventaLocalEditOrdenId ? "put" : "post",
        path: ventaLocalEditOrdenId ? `/admin/ventas-locales/${ventaLocalEditOrdenId}` : "/admin/ventas-locales",
        body: {
          usuario_id: ventaLocalClienteId ? Number(ventaLocalClienteId) : undefined,
          cliente_local: ventaLocalClienteId || !hasManualCustomer
            ? undefined
            : {
                nombre: ventaLocalClienteManualNombre.trim(),
                dni: ventaLocalClienteManualDni.trim() || undefined,
              },
          sucursal_id: Number(ventaLocalSucursalId),
          metodo_pago: ventaLocalMetodoPago,
          acreditar_puntos: Boolean(clienteVentaLocalSeleccionado?.id),
          items: ventaLocalItems.map((item) => ({
            producto_id: item.producto_id,
            cantidad: item.cantidad,
            sabores: item.sabores?.map((sabor) => ({
              sabor_id: sabor.sabor_id,
              cantidad: sabor.cantidad,
            })),
          })),
        },
      }) as VentaLocalSubmitResult;
      const editedOrderId = ventaLocalEditOrdenId;
      resetVentaLocalForm();
      setOkMsg(
        editedOrderId
          ? `Venta local #${editedOrderId} actualizada. Se ajustaron stock, caja y puntos.`
          : `Venta local registrada${result.ordenId ? ` como orden #${result.ordenId}` : ""}. El stock compartido de la sucursal se actualizo.`,
      );
      await refreshQueries([
        ["admin", "ordenes"],
        ["admin", "inventario"],
        ["admin", "movimientos-stock"],
        ["admin", "movimientos"],
        ["admin", "usuarios"],
        ["admin", "stats"],
        ["admin", "caja-actual", cajaSucursalId],
        ["admin", "caja-sesiones", cajaSucursalId],
      ]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function descargarVentas(formato: "pdf" | "html" | "xlsx" | "xls") {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      const params = new URLSearchParams({ formato });
      if (ventasExportCanal) params.set("canal", ventasExportCanal);
      if (ventasExportDesde) params.set("desde", ventasExportDesde);
      if (ventasExportHasta) params.set("hasta", ventasExportHasta);
      if (ordenesFiltroEstado) params.set("estado", ordenesFiltroEstado);
      if (formato === "html") {
        window.open(apiUrl(`/api/admin/ventas/export?${params.toString()}`), "_blank", "noopener,noreferrer");
      } else {
        const headers = new Headers();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        const response = await fetch(apiUrl(`/api/admin/ventas/export?${params.toString()}`), {
          credentials: "include",
          headers,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || "No se pudo exportar ventas.");
        }

        const extension = formato === "pdf" ? "pdf" : formato === "xlsx" ? "xlsx" : "xls";
        const mimeType =
          formato === "pdf"
            ? "application/pdf"
            : formato === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/vnd.ms-excel";
        const blob = await response.blob();
        const filename = getDownloadFilename(response.headers.get("Content-Disposition"), `ventas-${getBuenosAiresDateStamp()}.${extension}`);
        const saveResult = await saveBlobWithPicker(blob, filename, mimeType);
        if (saveResult === "cancelled") return;
      }
      setOkMsg(
        formato === "html"
          ? "Se abrio la vista imprimible en una pestana normal del navegador."
          : formato === "pdf"
            ? "PDF generado correctamente."
            : "Excel generado correctamente.",
      );
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function descargarCajaPdf(fecha = cajaReporteFecha, sucursalId = cajaSucursalId) {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!sucursalId) throw new Error("Selecciona una sucursal para exportar la caja.");
      if (!fecha) throw new Error("Selecciona el dia de caja que queres exportar.");
      const params = new URLSearchParams({
        sucursal_id: String(sucursalId),
        fecha,
      });
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(apiUrl(`/api/admin/caja/export?${params.toString()}`), {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "No se pudo exportar la caja.");
      }
      const blob = await response.blob();
      const filename = getDownloadFilename(response.headers.get("Content-Disposition"), `caja-${fecha}.pdf`);
      const saveResult = await saveBlobWithPicker(blob, filename, "application/pdf");
      if (saveResult === "cancelled") return;
      setOkMsg("PDF de caja generado correctamente.");
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function descargarCvPostulacion(postulacion: PostulacionCv) {
    if (postulacion.archivo_disponible === false) {
      setErrMsg("El archivo del CV no esta disponible en el servidor. Puede haberse borrado, no haberse copiado al deploy o pertenecer a otro entorno.");
      setOkMsg("");
      return;
    }

    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(apiUrl(`/api/postulaciones/admin/${postulacion.id}/cv`), {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "No se pudo descargar el CV.");
      }
      const blob = await response.blob();
      const filename = getDownloadFilename(response.headers.get("Content-Disposition"), postulacion.archivo_original || `cv-${postulacion.id}.pdf`);
      const saveResult = await saveBlobWithPicker(blob, filename, postulacion.mime_type || "application/octet-stream");
      if (saveResult === "cancelled") return;
      setOkMsg("CV descargado correctamente.");
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function expirarReservas() {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      const result = await api.post<{ ok: boolean; ordenes_expiradas: number; canjes_expirados: number }>("/admin/reservas/expirar");
      setOkMsg(`Reservas revisadas. Ordenes expiradas: ${result.ordenes_expiradas}. Canjes expirados: ${result.canjes_expirados}.`);
      await refreshQueries([["admin", "ordenes"], ["admin", "canjes"], ["admin", "inventario"], ["admin", "movimientos-stock"], ["admin", "movimientos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ejecutarLimpiezaPostulaciones() {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      const result = await commandMutation.mutateAsync({
        method: "patch",
        path: "/postulaciones/admin/limpiar",
      }) as { archivadas?: number };
      setPostulacionesPage(1);
      await refreshQueries([["admin", "postulaciones"]]);
      setOkMsg(`Listado de postulantes limpiado. Archivadas: ${result.archivadas ?? 0}.`);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function limpiarPostulaciones() {
    if (!postulacionesFiltradas.length) return;

    confirmToast({
      tone: "warning",
      title: "Limpiar postulantes",
      message: "Esto va a ocultar el listado de postulantes del panel, pero no los borra de la base de datos.",
      confirmLabel: "Limpiar",
      cancelLabel: "Cancelar",
      onConfirm: () => {
        void ejecutarLimpiezaPostulaciones();
      },
    });
  }

  function cargarFormularioCaja(sesion: CajaSesionAdmin | null) {
    if (!sesion) {
      setCajaMontoApertura("");
      setCajaMontoCierre("");
      setCajaObservacionesApertura("");
      setCajaObservacionesCierre("");
      return;
    }
    setCajaSucursalId(String(sesion.sucursal_id));
    setCajaMontoApertura(emptyZeroInputValue(sesion.monto_apertura));
    setCajaMontoCierre(emptyZeroInputValue(sesion.monto_cierre_declarado ?? sesion.summary.efectivoSistema));
    setCajaObservacionesApertura(sesion.observaciones_apertura ?? "");
    setCajaObservacionesCierre(sesion.observaciones_cierre ?? "");
  }

  function iniciarEdicionCaja(sesion: CajaSesionAdmin) {
    setCajaEditSesion(sesion);
    cargarFormularioCaja(sesion);
    setErrMsg("");
    setOkMsg("");
  }

  function cancelarEdicionCaja() {
    setCajaEditSesion(null);
    setErrMsg("");
    setOkMsg("");
    cargarFormularioCaja(cajaActual);
  }

  async function guardarCajaEditada() {
    if (!cajaEditSesion) return;
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/caja/sesiones/${cajaEditSesion.id}`,
        body: {
          monto_apertura: Number(cajaMontoApertura || 0),
          observaciones_apertura: cajaObservacionesApertura.trim() || undefined,
          monto_cierre_declarado: cajaEditSesion.estado === "cerrada" ? Number(cajaMontoCierre || 0) : undefined,
          observaciones_cierre: cajaEditSesion.estado === "cerrada" ? (cajaObservacionesCierre.trim() || undefined) : undefined,
        },
      });
      const cajaFecha = cajaEditSesion.fecha_operativa;
      setCajaEditSesion(null);
      cargarFormularioCaja(cajaActual);
      setOkMsg(`Caja del ${cajaFecha} actualizada correctamente.`);
      await refreshQueries([
        ["admin", "caja-actual", cajaSucursalId],
        ["admin", "caja-sesiones", cajaSucursalId],
        ["admin", "gastos", cajaSucursalId],
        ["admin", "ordenes"],
      ]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function abrirCaja() {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!cajaSucursalId) throw new Error("Selecciona una sucursal para guardar la apertura.");
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/caja/apertura",
        body: {
          sucursal_id: Number(cajaSucursalId),
          monto_apertura: Number(cajaMontoApertura || 0),
          observaciones: cajaObservacionesApertura.trim() || undefined,
        },
      });
      setCajaObservacionesApertura("");
      setCajaMontoCierre(cajaMontoApertura);
      setOkMsg("Apertura de caja guardada correctamente.");
      await refreshQueries([["admin", "caja-actual", cajaSucursalId], ["admin", "caja-sesiones", cajaSucursalId]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cerrarCaja() {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!cajaActual?.id) throw new Error("No hay una caja abierta para cerrar.");
      await commandMutation.mutateAsync({
        method: "post",
        path: `/admin/caja/${cajaActual.id}/cierre`,
        body: {
          monto_cierre_declarado: Number(cajaMontoCierre || 0),
          observaciones: cajaObservacionesCierre.trim() || undefined,
        },
      });
      setCajaObservacionesCierre("");
      setOkMsg("Caja cerrada correctamente.");
      await refreshQueries([["admin", "caja-actual", cajaSucursalId], ["admin", "caja-sesiones", cajaSucursalId], ["admin", "gastos", cajaSucursalId]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function registrarGasto() {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!cajaSucursalId) throw new Error("Selecciona una sucursal para registrar el gasto.");
      if (!gastoCategoria.trim() || !gastoDescripcion.trim()) {
        throw new Error("Completa categoria y descripcion del gasto.");
      }
      if (!gastoProveedorId && !gastoTerceroNombre.trim()) {
        throw new Error("Selecciona un proveedor o escribe un tercero.");
      }
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/gastos",
        body: {
          sucursal_id: Number(cajaSucursalId),
          proveedor_id: gastoProveedorId ? Number(gastoProveedorId) : undefined,
          tercero_nombre: gastoProveedorId ? undefined : gastoTerceroNombre.trim(),
          categoria: gastoCategoria.trim(),
          descripcion: gastoDescripcion.trim(),
          medio_pago: gastoMedioPago,
          monto: Number(gastoMonto || 0),
          notas: gastoNotas.trim() || undefined,
        },
      });
      setGastoProveedorId("");
      setGastoTerceroNombre("");
      setGastoCategoria("");
      setGastoDescripcion("");
      setGastoMonto("");
      setGastoMedioPago("cash");
      setGastoNotas("");
      setOkMsg("Gasto registrado correctamente.");
      await refreshQueries([["admin", "gastos", cajaSucursalId], ["admin", "caja-actual", cajaSucursalId], ["admin", "caja-sesiones", cajaSucursalId]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function empezarEditarGasto(gasto: GastoAdmin) {
    setErrMsg("");
    setOkMsg("");
    setGastoEditId(gasto.id);
    setGastoEditDraft({
      sucursal_id: String(gasto.sucursal_id),
      proveedor_id: gasto.proveedor_id ? String(gasto.proveedor_id) : "",
      tercero_nombre: gasto.tercero_nombre ?? "",
      categoria: gasto.categoria ?? "",
      descripcion: gasto.descripcion ?? "",
      medio_pago: gasto.medio_pago || "cash",
      monto: emptyZeroInputValue(gasto.monto),
      notas: gasto.notas ?? "",
    });
  }

  async function guardarGastoEditado() {
    if (!gastoEditId) return;
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!gastoEditDraft.categoria.trim() || !gastoEditDraft.descripcion.trim()) {
        throw new Error("Completa categoria y descripcion del gasto.");
      }
      if (!gastoEditDraft.proveedor_id && !gastoEditDraft.tercero_nombre.trim()) {
        throw new Error("Selecciona un proveedor o escribe un tercero.");
      }
      const monto = Number(gastoEditDraft.monto || 0);
      if (!Number.isFinite(monto) || monto <= 0) throw new Error("Completa un monto mayor a 0.");
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/gastos/${gastoEditId}`,
        body: {
          sucursal_id: Number(gastoEditDraft.sucursal_id),
          proveedor_id: gastoEditDraft.proveedor_id ? Number(gastoEditDraft.proveedor_id) : undefined,
          tercero_nombre: gastoEditDraft.proveedor_id ? undefined : gastoEditDraft.tercero_nombre.trim(),
          categoria: gastoEditDraft.categoria.trim(),
          descripcion: gastoEditDraft.descripcion.trim(),
          medio_pago: gastoEditDraft.medio_pago,
          monto,
          notas: gastoEditDraft.notas.trim() || undefined,
        },
      });
      setGastoEditId(null);
      setOkMsg("Gasto actualizado correctamente.");
      await refreshQueries([["admin", "gastos", cajaSucursalId], ["admin", "caja-actual", cajaSucursalId], ["admin", "caja-sesiones", cajaSucursalId]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function crearProveedor() {
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!nuevoProveedor.nombre.trim()) throw new Error("El nombre del proveedor es obligatorio.");
      await commandMutation.mutateAsync({
        method: "post",
        path: "/admin/proveedores",
        body: {
          nombre: nuevoProveedor.nombre.trim(),
          contacto: nuevoProveedor.contacto.trim() || undefined,
          telefono: nuevoProveedor.telefono.trim() || undefined,
          email: nuevoProveedor.email.trim() || undefined,
          notas: nuevoProveedor.notas.trim() || undefined,
        },
      });
      setNuevoProveedor({ nombre: "", contacto: "", telefono: "", email: "", notas: "" });
      setOkMsg("Proveedor creado.");
      await refreshQueries([["admin", "proveedores"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function empezarEditarProveedor(proveedor: ProveedorAdmin) {
    setErrMsg("");
    setOkMsg("");
    setProveedorEditId(proveedor.id);
    setProveedorEditDraft({
      nombre: proveedor.nombre ?? "",
      contacto: proveedor.contacto ?? "",
      telefono: proveedor.telefono ?? "",
      email: proveedor.email ?? "",
      notas: proveedor.notas ?? "",
      activo: proveedor.activo !== false,
    });
  }

  async function guardarProveedorEditado() {
    if (!proveedorEditId) return;
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    try {
      if (!proveedorEditDraft.nombre.trim()) throw new Error("El nombre del proveedor es obligatorio.");
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/proveedores/${proveedorEditId}`,
        body: {
          nombre: proveedorEditDraft.nombre.trim(),
          contacto: proveedorEditDraft.contacto.trim() || undefined,
          telefono: proveedorEditDraft.telefono.trim() || undefined,
          email: proveedorEditDraft.email.trim() || undefined,
          notas: proveedorEditDraft.notas.trim() || undefined,
          activo: proveedorEditDraft.activo,
        },
      });
      setProveedorEditId(null);
      setOkMsg("Proveedor actualizado.");
      await refreshQueries([["admin", "proveedores"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateCostoCobroDraft(
    proveedor: string,
    metodo: string,
    patch: Partial<PaymentFeeDraftValue>,
  ) {
    const key = paymentFeeDraftKey(proveedor, metodo);
    setCostosCobroDraft((prev) => ({
      ...prev,
      [key]: {
        descripcion: prev[key]?.descripcion ?? "",
        porcentaje: prev[key]?.porcentaje ?? "",
        activo: prev[key]?.activo ?? true,
        ...patch,
      },
    }));
  }

  async function guardarCostosCobro() {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      const payload = costosCobro.map((item) => {
        const draft = costosCobroDraft[paymentFeeDraftKey(item.proveedor, item.metodo)] ?? {
          descripcion: item.descripcion,
          porcentaje: emptyZeroInputValue(item.porcentaje),
          activo: Boolean(item.activo),
        };
        const porcentaje = Math.max(0, Math.min(100, Number(draft.porcentaje || 0)));
        if (!Number.isFinite(porcentaje)) {
          throw new Error(`El porcentaje de ${formatProveedorPago(item.proveedor)} / ${formatMetodoPago(item.metodo)} es invalido.`);
        }
        return {
          proveedor: item.proveedor,
          metodo: item.metodo,
          descripcion: draft.descripcion.trim() || item.descripcion,
          porcentaje,
          activo: draft.activo,
        };
      });

      await commandMutation.mutateAsync({
        method: "put",
        path: "/admin/costos-cobro",
        body: payload,
      });
      setOkMsg("Costos de cobro guardados.");
      await refreshQueries([["admin", "costos-cobro"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
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
          descripcion: nuevaCategoria.descripcion.trim() || null,
          imagen_url: nuevaCategoria.imagen_url?.trim() || null,
          orden: nuevaCategoria.orden ?? 0,
          mostrar_en_home: nuevaCategoria.mostrar_en_home,
          activo: nuevaCategoria.activo,
        },
      });
      setNuevaCategoria({ nombre: "", descripcion: "", imagen_url: "", orden: 0, mostrar_en_home: false, activo: true });
      setCategoriasPage(1);
      setDescuentosCategoriasLoaded(false);
      setOkMsg("Categoria creada.");
      await refreshQueries([["admin", "categorias"], ["admin", "descuentos-categorias"], ["admin", "productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function empezarEditarCategoria(categoria: Categoria) {
    setCategoriaEditId(categoria.id);
    setCategoriaEditDraft({
      nombre: categoria.nombre,
      descripcion: categoria.descripcion ?? "",
      imagen_url: categoria.imagen_url ?? "",
      orden: categoria.orden ?? 0,
      mostrar_en_home: Boolean(categoria.mostrar_en_home),
      activo: categoria.activo !== false,
    });
  }

  function cancelarEditarCategoria() {
    setCategoriaEditId(null);
    setCategoriaEditDraft({ nombre: "", descripcion: "", imagen_url: "", orden: 0, mostrar_en_home: false, activo: true });
  }

  async function guardarCategoriaEditada() {
    setErrMsg("");
    setOkMsg("");
    if (!categoriaEditId) return;
    if (!categoriaEditDraft.nombre.trim()) {
      setErrMsg("El nombre de categoria es obligatorio.");
      return;
    }

    setBusy(true);
    try {
      await commandMutation.mutateAsync({
        method: "put",
        path: `/admin/categorias/${categoriaEditId}`,
        body: {
          nombre: categoriaEditDraft.nombre.trim(),
          descripcion: categoriaEditDraft.descripcion.trim() || null,
          imagen_url: categoriaEditDraft.imagen_url?.trim() || null,
          orden: categoriaEditDraft.orden ?? 0,
          mostrar_en_home: categoriaEditDraft.mostrar_en_home,
          activo: categoriaEditDraft.activo,
        },
      });
      cancelarEditarCategoria();
      setCategoriasPage(1);
      setDescuentosCategoriasLoaded(false);
      setOkMsg("Categoria actualizada.");
      await refreshQueries([["admin", "categorias"], ["admin", "descuentos-categorias"], ["admin", "productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCategoriaActiva(categoria: Categoria) {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      const nextActivo = categoria.activo === false;
      await commandMutation.mutateAsync({
        method: "patch",
        path: `/admin/categorias/${categoria.id}/activo`,
        body: { activo: nextActivo },
      });
      if (categoriaEditId === categoria.id) cancelarEditarCategoria();
      setCategoriasPage(1);
      setDescuentosCategoriasLoaded(false);
      setOkMsg(nextActivo ? "Categoria activada." : "Categoria desactivada.");
      await refreshQueries([["admin", "categorias"], ["admin", "descuentos-categorias"], ["admin", "productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateDescuentoCategoriaDraft(tipoCliente: TipoCliente, categoria: string, rawValue: string) {
    const key = discountDraftKey(tipoCliente, categoria);
    setDescuentosCategoriasDraft((prev) => ({
      ...prev,
      [key]: normalizeDiscountDraftValue(rawValue),
    }));
  }

  async function guardarDescuentosCategorias() {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      for (const categoria of categoriasActivas) {
        for (const tipoCliente of DISCOUNT_CLIENT_TYPES) {
          const rawValue = descuentosCategoriasDraft[discountDraftKey(tipoCliente, categoria.nombre)] ?? "";
          const descuento = Math.max(0, Math.min(100, Number(rawValue || 0)));
          if (!Number.isFinite(descuento)) {
            throw new Error(`Hay un descuento invalido en ${categoria.nombre} para ${formatTipoClienteLabel(tipoCliente).toLowerCase()}.`);
          }
          await commandMutation.mutateAsync({
            method: "put",
            path: "/admin/descuentos-categorias",
            body: {
              tipo_cliente: tipoCliente,
              categoria: categoria.nombre,
              descuento_porcentaje: descuento,
              activo: descuento > 0,
            },
          });
        }
      }
      setOkMsg("Descuentos por categoria guardados.");
      await refreshQueries([["admin", "descuentos-categorias"], ["admin", "productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateDescuentoProductoDraft(tipoCliente: TipoCliente, productoId: number, rawValue: string) {
    const key = productDiscountDraftKey(tipoCliente, productoId);
    setDescuentosProductosDraft((prev) => ({
      ...prev,
      [key]: normalizeDiscountDraftValue(rawValue),
    }));
  }

  async function guardarDescuentosProductos() {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      for (const producto of productosDescuentoUnitario) {
        for (const tipoCliente of DISCOUNT_CLIENT_TYPES) {
          const rawValue = descuentosProductosDraft[productDiscountDraftKey(tipoCliente, Number(producto.id))] ?? "";
          const descuento = Math.max(0, Math.min(100, Number(rawValue || 0)));
          if (!Number.isFinite(descuento)) {
            throw new Error(`Hay un descuento invalido en ${producto.nombre} para ${formatTipoClienteLabel(tipoCliente).toLowerCase()}.`);
          }
          await commandMutation.mutateAsync({
            method: "put",
            path: "/admin/descuentos-productos",
            body: {
              tipo_cliente: tipoCliente,
              producto_id: Number(producto.id),
              descuento_porcentaje: descuento,
              activo: descuento > 0,
            },
          });
        }
      }
      setDescuentosProductosLoaded(false);
      setOkMsg("Descuentos por producto guardados.");
      await refreshQueries([["admin", "descuentos-productos"], ["admin", "productos"], ["productos"], ["home", "productos"]]);
    } catch (error) {
      setErrMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function guardarCampaniaWeb() {
    setErrMsg("");
    setOkMsg("");
    setBusy(true);
    try {
      const values = {
        cliente: Math.max(0, Math.min(100, Number(webDiscountDraft.cliente || 0))),
        mayorista: Math.max(0, Math.min(100, Number(webDiscountDraft.mayorista || 0))),
        empleado: Math.max(0, Math.min(100, Number(webDiscountDraft.empleado || 0))),
      };
      if (Object.values(values).some((value) => !Number.isFinite(value))) {
        throw new Error("Revisa los porcentajes de la campana web.");
      }

      const campaniaActiva = Object.values(values).some((value) => value > 0);

      await Promise.all([
        commandMutation.mutateAsync({
          method: "put",
          path: "/admin/configuracion/descuento_web_global_activo",
          body: { valor: campaniaActiva ? "1" : "0", descripcion: "Activa una campana global web temporal si hay descuentos configurados." },
        }),
        commandMutation.mutateAsync({
          method: "put",
          path: "/admin/configuracion/descuento_web_global_cliente",
          body: { valor: String(values.cliente), descripcion: "Descuento global web para clientes." },
        }),
        commandMutation.mutateAsync({
          method: "put",
          path: "/admin/configuracion/descuento_web_global_mayorista",
          body: { valor: String(values.mayorista), descripcion: "Descuento global web para mayoristas." },
        }),
        commandMutation.mutateAsync({
          method: "put",
          path: "/admin/configuracion/descuento_web_global_empleado",
          body: { valor: String(values.empleado), descripcion: "Descuento global web para empleados." },
        }),
      ]);

      setWebDiscountDraft((prev) => ({ ...prev, activo: campaniaActiva }));
      setOkMsg(campaniaActiva ? "Campana global web activada." : "Campana global web desactivada.");
      await refreshQueries([["admin", "configuracion"], ["admin", "productos"]]);
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
      tipo_cliente: usuario.tipo_cliente ?? "cliente",
      descuento_porcentaje: "",
      dni: usuario.dni || "",
      telefono: usuario.telefono || "",
      fecha_nacimiento: usuario.fecha_nacimiento || "",
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
      tipo_cliente: "cliente",
      descuento_porcentaje: "",
      dni: "",
      telefono: "",
      fecha_nacimiento: "",
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
          tipo_cliente: editUsuarioDraft.rol === "cliente" ? editUsuarioDraft.tipo_cliente : "cliente",
          descuento_porcentaje: 0,
          dni: editUsuarioDraft.dni.trim() || null,
          telefono: editUsuarioDraft.telefono.trim() || null,
          fecha_nacimiento: editUsuarioDraft.fecha_nacimiento.trim() || null,
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
    const passwordErrors = passwordValidationErrors(nuevoUsuario.password);
    if (passwordErrors.length > 0) {
      setErrMsg(`Contrasena invalida: ${passwordErrors.join(", ")}.`);
      return;
    }
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
          tipo_cliente: nuevoUsuario.rol === "cliente" ? nuevoUsuario.tipo_cliente : "cliente",
          descuento_porcentaje: 0,
          dni: nuevoUsuario.rol === "cliente" ? nuevoUsuario.dni : undefined,
        },
      });
      setNuevoUsuario({ email: "", password: "", nombre: "", rol: "cliente", tipo_cliente: "cliente", descuento_porcentaje: "", dni: "" });
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
      
      await refreshQueries([["admin", "canjes"], ["admin", "inventario"], ["admin", "movimientos-stock"], ["admin", "stats"]]);
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
      await refreshQueries([["admin", "canjes"], ["admin", "inventario"], ["admin", "movimientos-stock"], ["admin", "stats"]]);
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

  async function guardarConfiguracionItems(updates: Array<{ clave: string; valor: string; descripcion: string }>) {
    await Promise.all(
      updates.map((item) =>
        commandMutation.mutateAsync({
          method: "put",
          path: `/admin/configuracion/${item.clave}`,
          body: { valor: item.valor, descripcion: item.descripcion },
        }),
      ),
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "configuracion"] });
  }

  async function guardarConfiguracionGeneral() {
    setConfigErr("");
    setConfigMsg("");

    const diasLimiteRetiro = Number(configDraft.dias_limite_retiro);
    const puntosMontoBase = Number(configDraft.puntos_monto_base);
    const puntosPorMonto = Number(configDraft.puntos_por_monto);
    const puntosVencimientoMeses = Number(configDraft.puntos_vencimiento_meses);
    const puntosAlertaPreVencimientoValor = Number(configDraft.puntos_alerta_pre_vencimiento_valor);
    const puntosAlertaPreVencimientoUnidad = configDraft.puntos_alerta_pre_vencimiento_unidad === "semanas"
      ? "semanas"
      : "meses";
    const puntosInvitador = Number(configDraft.puntos_referido_invitador);
    const puntosInvitado = Number(configDraft.puntos_referido_invitado);
    const longitudCodigoInvitacion = Number(configDraft.longitud_codigo_invitacion);
    const envioGratisMontoMinimo = Number(configDraft.envio_gratis_monto_minimo);
    const limiteCompraCliente = Number(configDraft.limite_compra_cliente || 0);
    const limiteCompraMayorista = Number(configDraft.limite_compra_mayorista || 0);
    const limiteCompraEmpleado = Number(configDraft.limite_compra_empleado || 0);
    const pedidoEfectivoDiasVigencia = Number(configDraft.pedido_efectivo_dias_vigencia);
    const empresaDiasHabilesRetiro = configDraft.empresa_dias_habiles_retiro.trim();
    const empresaHorarioRetiro = configDraft.empresa_horario_retiro.trim();
    const pedidoComprobanteLeyenda = configDraft.pedido_comprobante_leyenda.trim();
    const chatbotActivo = configDraft.chatbot_activo;

    if (!Number.isInteger(diasLimiteRetiro) || diasLimiteRetiro <= 0 || diasLimiteRetiro > 90) {
      setConfigErr("Los dias limite de retiro deben ser un numero entero entre 1 y 90.");
      return;
    }
    if (!Number.isFinite(puntosMontoBase) || puntosMontoBase <= 0 || puntosMontoBase > 999999999) {
      setConfigErr("El monto base para sumar puntos debe ser mayor a 0.");
      return;
    }
    if (!Number.isInteger(puntosPorMonto) || puntosPorMonto < 0 || puntosPorMonto > 1000000) {
      setConfigErr("Los puntos por monto deben ser un numero entero entre 0 y 1000000.");
      return;
    }
    if (!Number.isInteger(puntosVencimientoMeses) || puntosVencimientoMeses < 1 || puntosVencimientoMeses > 120) {
      setConfigErr("El vencimiento de puntos debe ser un numero entero entre 1 y 120 meses.");
      return;
    }
    if (!Number.isInteger(puntosAlertaPreVencimientoValor) || puntosAlertaPreVencimientoValor < 1 || puntosAlertaPreVencimientoValor > 120) {
      setConfigErr("La anticipacion del aviso de puntos debe ser un numero entero entre 1 y 120.");
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
    if (!Number.isFinite(envioGratisMontoMinimo) || envioGratisMontoMinimo < 0 || envioGratisMontoMinimo > 999999999) {
      setConfigErr("El monto minimo para envio gratis debe ser un numero mayor o igual a 0.");
      return;
    }
    const limitesCompra = [
      { label: "cliente", value: limiteCompraCliente },
      { label: "mayorista", value: limiteCompraMayorista },
      { label: "empleado", value: limiteCompraEmpleado },
    ];
    const limiteCompraInvalido = limitesCompra.find((item) => !Number.isInteger(item.value) || item.value < 0 || item.value > 100000);
    if (limiteCompraInvalido) {
      setConfigErr(`El limite de compra para ${limiteCompraInvalido.label} debe ser un entero entre 0 y 100000.`);
      return;
    }
    if (!Number.isInteger(pedidoEfectivoDiasVigencia) || pedidoEfectivoDiasVigencia < 1 || pedidoEfectivoDiasVigencia > 30) {
      setConfigErr("Los dias de vigencia para pedidos en efectivo deben ser un entero entre 1 y 30.");
      return;
    }
    if (!empresaDiasHabilesRetiro) {
      setConfigErr("Completa los dias habiles de retiro.");
      return;
    }
    if (!empresaHorarioRetiro) {
      setConfigErr("Completa el horario de retiro.");
      return;
    }
    if (!pedidoComprobanteLeyenda) {
      setConfigErr("Completa la leyenda legal del comprobante.");
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
          clave: "puntos_monto_base",
          valor: String(Math.round((puntosMontoBase + Number.EPSILON) * 100) / 100),
          descripcion: "Monto de compra que habilita un tramo de puntos.",
        },
        {
          clave: "puntos_por_monto",
          valor: String(puntosPorMonto),
          descripcion: "Puntos que se acreditan por cada tramo de monto configurado.",
        },
        {
          clave: "puntos_vencimiento_meses",
          valor: String(puntosVencimientoMeses),
          descripcion: "Cantidad de meses de vigencia para cada lote de puntos acreditado.",
        },
        {
          clave: "puntos_alerta_pre_vencimiento_valor",
          valor: String(puntosAlertaPreVencimientoValor),
          descripcion: "Cantidad de semanas o meses de anticipacion para avisar que los puntos estan por vencer.",
        },
        {
          clave: "puntos_alerta_pre_vencimiento_unidad",
          valor: puntosAlertaPreVencimientoUnidad,
          descripcion: "Unidad de anticipacion para avisar puntos por vencer: semanas o meses.",
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
        {
          clave: "envio_gratis_monto_minimo",
          valor: String(Math.round((envioGratisMontoMinimo + Number.EPSILON) * 100) / 100),
          descripcion: "Monto minimo de productos para que el envio sea gratis. 0 desactiva la regla.",
        },
        {
          clave: "limite_compra_cliente",
          valor: String(limiteCompraCliente),
          descripcion: "Cantidad maxima por producto para clientes comunes. 0 significa sin tope comercial.",
        },
        {
          clave: "limite_compra_mayorista",
          valor: String(limiteCompraMayorista),
          descripcion: "Cantidad maxima por producto para clientes mayoristas. 0 significa sin tope comercial.",
        },
        {
          clave: "limite_compra_empleado",
          valor: String(limiteCompraEmpleado),
          descripcion: "Cantidad maxima por producto para clientes empleados. 0 significa sin tope comercial.",
        },
        {
          clave: "pedido_efectivo_dias_vigencia",
          valor: String(pedidoEfectivoDiasVigencia),
          descripcion: "Dias habiles que se reserva un pedido en efectivo antes de expirar.",
        },
        {
          clave: "empresa_dias_habiles_retiro",
          valor: empresaDiasHabilesRetiro,
          descripcion: "Dias habiles en los que la empresa entrega pedidos en sucursal.",
        },
        {
          clave: "empresa_horario_retiro",
          valor: empresaHorarioRetiro,
          descripcion: "Horario de atencion para retiro de pedidos en sucursal.",
        },
        {
          clave: "pedido_comprobante_leyenda",
          valor: pedidoComprobanteLeyenda,
          descripcion: "Leyenda legal que se muestra al pie del comprobante de pedidos.",
        },
        {
          clave: "chatbot_activo",
          valor: chatbotActivo ? "1" : "0",
          descripcion: "Activar o desactivar el asistente virtual de inteligencia artificial.",
        },
      ];

      await guardarConfiguracionItems(updates);
      setConfigMsg("Configuracion general actualizada.");
    } catch (error) {
      setConfigErr((error as Error).message);
    } finally {
      setConfigBusy(false);
    }
  }

  async function guardarEventbar() {
    setEventbarErr("");
    setEventbarMsg("");

    const eventbarTitulo = configDraft.eventbar_titulo.trim();
    const eventbarSubtitulo = configDraft.eventbar_subtitulo.trim();
    const eventbarFechaFinIso = datetimeLocalInputToIso(configDraft.eventbar_fecha_fin);
    const eventbarFechaFinMs = eventbarFechaFinIso ? new Date(eventbarFechaFinIso).getTime() : NaN;
    const eventbarColorFondo = configDraft.eventbar_color_fondo.trim();
    const eventbarColorTexto = configDraft.eventbar_color_texto.trim();
    const eventbarDescuentoEspecialTipo = normalizeEventbarDescuentoEspecialTipo(configDraft.eventbar_descuento_especial_tipo);
    const eventbarTieneDatos = Boolean(
      eventbarTitulo ||
      eventbarSubtitulo ||
      configDraft.eventbar_fecha_fin.trim() ||
      eventbarDescuentoEspecialTipo !== "none",
    );
    const eventbarActivo = eventbarTieneDatos && eventbarTitulo.length >= 2 && Number.isFinite(eventbarFechaFinMs) && eventbarFechaFinMs > Date.now();

    if (!isValidHexColor(eventbarColorFondo)) {
      setEventbarErr("El color de fondo de la eventbar debe tener formato #RRGGBB.");
      return;
    }
    if (!isValidHexColor(eventbarColorTexto)) {
      setEventbarErr("El color de texto de la eventbar debe tener formato #RRGGBB.");
      return;
    }
    if (eventbarTieneDatos) {
      if (eventbarTitulo.length < 2 || eventbarTitulo.length > 120) {
        setEventbarErr("El titulo de la eventbar debe tener entre 2 y 120 caracteres.");
        return;
      }
      if (eventbarSubtitulo.length > 160) {
        setEventbarErr("El subtitulo de la eventbar no puede superar 160 caracteres.");
        return;
      }
      if (!Number.isFinite(eventbarFechaFinMs)) {
        setEventbarErr("Selecciona una fecha y hora final valida para la eventbar.");
        return;
      }
      if (eventbarFechaFinMs <= Date.now()) {
        setEventbarErr("La fecha final de la eventbar debe estar en el futuro.");
        return;
      }
    }

    setConfigBusy(true);
    try {
      await guardarConfiguracionItems([
        {
          clave: "eventbar_activo",
          valor: eventbarActivo ? "1" : "0",
          descripcion: "Activa o desactiva la barra superior de evento temporal.",
        },
        {
          clave: "eventbar_titulo",
          valor: eventbarTitulo,
          descripcion: "Texto principal que se muestra en la barra superior de evento.",
        },
        {
          clave: "eventbar_subtitulo",
          valor: eventbarSubtitulo,
          descripcion: "Texto secundario que se muestra debajo del titulo en la barra superior de evento.",
        },
        {
          clave: "eventbar_fecha_fin",
          valor: eventbarFechaFinIso ?? "",
          descripcion: "Fecha y hora ISO en la que termina el evento de la barra superior.",
        },
        {
          clave: "eventbar_color_fondo",
          valor: eventbarColorFondo,
          descripcion: "Color de fondo de la barra superior de evento.",
        },
        {
          clave: "eventbar_color_texto",
          valor: eventbarColorTexto,
          descripcion: "Color de texto de la barra superior de evento.",
        },
        {
          clave: "eventbar_descuento_especial_activo",
          valor: eventbarDescuentoEspecialTipo === "none" ? "0" : "1",
          descripcion: "Activa el descuento especial de la eventbar para precios de tienda online.",
        },
        {
          clave: "eventbar_descuento_especial_tipo",
          valor: eventbarDescuentoEspecialTipo,
          descripcion: "Tipo de descuento especial de la eventbar: none, 2x1, 3x2 o 4x3.",
        },
      ]);

      setConfigDraft((prev) => ({ ...prev, eventbar_activo: eventbarActivo }));
      setEventbarMsg(eventbarActivo ? "Eventbar guardada y activa." : "Eventbar guardada desactivada.");
    } catch (error) {
      setEventbarErr((error as Error).message);
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
    return stripPageImages(contenido || "").trim();
  }

  function getPageDraft(slug: StaticPageSlug): EditorDraft {
    return slug === "terminos" ? terminosDraft : politicaPrivacidadDraft;
  }

  function getPageDraftSetter(slug: StaticPageSlug) {
    return slug === "terminos" ? setTerminosDraft : setPoliticaPrivacidadDraft;
  }

  async function guardarPagina(slug: StaticPageSlug) {
    const draft = getPageDraft(slug);
    const setDraft = getPageDraftSetter(slug);
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
  async function subirImagenConfig(key: keyof ConfiguracionDraft, file: File) {
    const formData = new FormData();
    formData.append("imagen", file);
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>("/admin/productos/upload", formData);
      setConfigDraft((prev) => ({ ...prev, [key]: url }));
    } catch (err) {
      alert("Error al subir imagen");
    } finally {
      setBusy(false);
    }
  }

  const stats = statsQuery.data;
  const eventbarPreviewCountdown = getEventbarCountdownPreview(configDraft.eventbar_fecha_fin);
  const eventbarDescuentoEspecialOption =
    EVENTBAR_DESCUENTO_ESPECIAL_OPTIONS.find((item) => item.value === configDraft.eventbar_descuento_especial_tipo)
    ?? EVENTBAR_DESCUENTO_ESPECIAL_OPTIONS[0];
  const eventbarPreviewPromoText = eventbarDiscountPromoText(configDraft.eventbar_descuento_especial_tipo);
  const canjeCodigoAdminFinalizado = canjeCodigoAdmin
    ? ["entregado", "cancelado", "expirado"].includes(canjeCodigoAdmin.estado)
    : false;

  function renderAdminNavLabel(label: string, badgeCount = 0) {
    return (
      <>
        <span>{label}</span>
        {badgeCount > 0 ? <span className="admin-nav-badge">{badgeCount > 99 ? "99+" : badgeCount}</span> : null}
      </>
    );
  }
  
  useEffect(() => {
    setMobileAdminNavOpen(false);
    if (tab !== "ordenes") {
      setVentasNavOpen(false);
    }
    if (!isProductosTab(tab)) {
      setProductosNavOpen(false);
    }
  }, [tab]);

  return (
    <section className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <p className="admin-brand-name">{isSuperAdminPanel ? "SuperAdmin" : "Administrador"}</p>
          <p className="admin-brand-role">{isSuperAdminPanel ? "Control total" : "Panel"}</p>
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
          <button className={`admin-nav-btn ${tab === "inicio" ? "active" : ""}`} onClick={() => seleccionarTab("inicio")}>
            {renderAdminNavLabel("Inicio")}
          </button>

          <span className="admin-nav-section">Gestion</span>
          <button className={`admin-nav-btn ${tab === "usuarios" ? "active" : ""}`} onClick={() => seleccionarTab("usuarios")}>
            {renderAdminNavLabel("Usuarios")}
          </button>
          <button className={`admin-nav-btn ${tab === "cumpleanos" ? "active" : ""}`} onClick={() => seleccionarTab("cumpleanos")}>
            {renderAdminNavLabel("Cumpleaños", cumpleanosPorAvisarConWhatsapp.length)}
          </button>
          <button className={`admin-nav-btn ${tab === "personas-app" ? "active" : ""}`} onClick={() => seleccionarTab("personas-app")}>
            {renderAdminNavLabel("Personas en app", appPresenceSummary?.active_now ?? 0)}
          </button>
          <div className={`admin-nav-group${isProductosTab(tab) ? " active" : ""}`}>
            <button className={`admin-nav-btn ${isProductosTab(tab) ? "active" : ""}`} onClick={toggleProductosNav}>
              <span className="admin-nav-label-with-caret">
                {renderAdminNavLabel("Productos")}
                <span className={`admin-nav-caret${productosNavOpen && isProductosTab(tab) ? " open" : ""}`} aria-hidden="true" />
              </span>
            </button>
            {productosNavOpen ? (
              <div className="admin-nav-submenu">
                <button
                  className={`admin-nav-subbtn${tab === "productos-crear" ? " active" : ""}`}
                  onClick={() => abrirVistaProductos("productos-crear")}
                >
                  Crear producto
                </button>
                <button
                  className={`admin-nav-subbtn${tab === "productos-edicion" ? " active" : ""}`}
                  onClick={() => abrirVistaProductos("productos-edicion")}
                >
                  Editar producto
                </button>
                <button
                  className={`admin-nav-subbtn${tab === "productos" ? " active" : ""}`}
                  onClick={() => abrirVistaProductos("productos")}
                >
                  Listar productos
                </button>
                <button
                  className={`admin-nav-subbtn${tab === "productos-sabores" ? " active" : ""}`}
                  onClick={() => abrirVistaProductos("productos-sabores")}
                >
                  Sabores de cajas
                </button>
              </div>
            ) : null}
          </div>
          <button className={`admin-nav-btn ${tab === "inventario" ? "active" : ""}`} onClick={() => seleccionarTab("inventario")}>
            {renderAdminNavLabel("Inventario")}
          </button>
          <button className={`admin-nav-btn ${tab === "postulaciones" ? "active" : ""}`} onClick={() => seleccionarTab("postulaciones")}>
            {renderAdminNavLabel("Postulaciones")}
          </button>
          <div className={`admin-nav-group${tab === "ordenes" ? " active" : ""}`}>
            <button className={`admin-nav-btn ${tab === "ordenes" ? "active" : ""}`} onClick={toggleVentasNav}>
              <span className="admin-nav-label-with-caret">
                {renderAdminNavLabel("Ventas", adminAlerts.ordenes)}
                <span className={`admin-nav-caret${ventasNavOpen && tab === "ordenes" ? " open" : ""}`} aria-hidden="true" />
              </span>
            </button>
            {ventasNavOpen ? (
              <div className="admin-nav-submenu">
                <button
                  className={`admin-nav-subbtn${tab === "ordenes" && ventasView === "pedidos" ? " active" : ""}`}
                  onClick={() => abrirVistaVentas("pedidos")}
                >
                  Pedidos
                </button>
                <button
                  className={`admin-nav-subbtn${tab === "ordenes" && ventasView === "reportes" ? " active" : ""}`}
                  onClick={() => abrirVistaVentas("reportes")}
                >
                  Reportes
                </button>
              </div>
            ) : null}
          </div>
          <button className={`admin-nav-btn ${tab === "caja" ? "active" : ""}`} onClick={() => seleccionarTab("caja")}>
            {renderAdminNavLabel("Caja")}
          </button>
          <button className={`admin-nav-btn ${tab === "gastos" ? "active" : ""}`} onClick={() => seleccionarTab("gastos")}>
            {renderAdminNavLabel("Gastos")}
          </button>
          <button className={`admin-nav-btn ${tab === "proveedores" ? "active" : ""}`} onClick={() => seleccionarTab("proveedores")}>
            {renderAdminNavLabel("Proveedores")}
          </button>
          <button className={`admin-nav-btn ${tab === "cobros" ? "active" : ""}`} onClick={() => seleccionarTab("cobros")}>
            {renderAdminNavLabel("Cobros")}
          </button>
          <button className={`admin-nav-btn ${tab === "descuentos" ? "active" : ""}`} onClick={() => seleccionarTab("descuentos")}>
            {renderAdminNavLabel("Descuentos")}
          </button>
          <button className={`admin-nav-btn ${tab === "categorias" ? "active" : ""}`} onClick={() => seleccionarTab("categorias")}>
            {renderAdminNavLabel("Categorias")}
          </button>
          <button className={`admin-nav-btn ${tab === "transacciones" ? "active" : ""}`} onClick={() => seleccionarTab("transacciones")}>
            {renderAdminNavLabel("Transacciones")}
          </button>
          <button className={`admin-nav-btn ${tab === "canjes" ? "active" : ""}`} onClick={() => seleccionarTab("canjes")}>
            {renderAdminNavLabel("Canjes", adminAlerts.canjes)}
          </button>
          <button className={`admin-nav-btn ${tab === "codigos" ? "active" : ""}`} onClick={() => seleccionarTab("codigos")}>
            {renderAdminNavLabel("Codigos")}
          </button>
          <button className="admin-nav-btn" onClick={irAPanelSucursales}>
            {renderAdminNavLabel("Sucursales")}
          </button>
          <button className="admin-nav-btn" onClick={irAPanelEnvios}>
            {renderAdminNavLabel("Zonas de envio")}
          </button>

          <span className="admin-nav-section">Configuracion</span>
          <button className={`admin-nav-btn ${tab === "crear" ? "active" : ""}`} onClick={() => seleccionarTab("crear")}>
            {renderAdminNavLabel("Crear usuario")}
          </button>
          <button className={`admin-nav-btn ${tab === "terminos" ? "active" : ""}`} onClick={() => seleccionarTab("terminos")}>
            {renderAdminNavLabel("Terminos")}
          </button>
          <button className={`admin-nav-btn ${tab === "politica-privacidad" ? "active" : ""}`} onClick={() => seleccionarTab("politica-privacidad")}>
            {renderAdminNavLabel("Privacidad")}
          </button>
          <button className={`admin-nav-btn ${tab === "arrepentimiento" ? "active" : ""}`} onClick={() => seleccionarTab("arrepentimiento")}>
            {renderAdminNavLabel("Arrepentimiento", adminAlerts.arrepentimiento)}
          </button>
          <button className={`admin-nav-btn ${tab === "layout-timeline" ? "active" : ""}`} onClick={() => seleccionarTab("layout-timeline")}>
            {renderAdminNavLabel("Línea de Tiempo")}
          </button>
          <button className={`admin-nav-btn ${tab === "layout-donde" ? "active" : ""}`} onClick={() => seleccionarTab("layout-donde")}>
            {renderAdminNavLabel("Dónde encontrarnos")}
          </button>
        </nav>
      </aside>

      <main className="admin-main">
        <div className="admin-topbar">
          <div className="admin-topbar-main">
            <h1 className="admin-topbar-title">{isSuperAdminPanel ? "Panel SuperAdmin" : "Panel de administracion"}</h1>
            <p className="admin-topbar-sub">
              {isSuperAdminPanel ? "Control completo del sistema, seguridad y respaldos" : "Resumen del programa de puntos"}
            </p>
          </div>
          <div className="admin-topbar-actions">
            {browserAlertsSupported ? (
              <button
                type="button"
                className={`admin-topbar-alert-toggle${browserNotificationPermission === "granted" ? " is-active" : ""}`}
                onClick={enableBrowserAlerts}
              >
                {browserNotificationPermission === "granted" ? "Alertas activas" : "Activar alertas"}
              </button>
            ) : null}
            <div className="admin-topbar-date">{formatBuenosAiresDate(new Date())}</div>
          </div>
        </div>

        <div className="admin-content" ref={adminContentRef}>
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
          {tab !== "ordenes" ? <AreaExplanation key={tab} items={ADMIN_AREA_EXPLANATIONS[tab]} /> : null}

          {tab === "inicio" ? (
            <>
              <div className="admin-section-header">
                <h2 className="admin-section-title">Ultimos movimientos</h2>
                <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                  <button className="adm-btn-link" onClick={() => setInicioMovimientosOpen((prev) => !prev)}>
                    {inicioMovimientosOpen ? "Ocultar" : "Mostrar"}
                  </button>
                  <button className="adm-btn-link" onClick={() => seleccionarTab("transacciones")}>
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

              {isSuperAdmin && (
                <>
                  <div className="admin-section-header adm-config-header">
                    <h2 className="admin-section-title">Asistente Virtual IA</h2>
                  </div>
                  <div className="admin-card admin-card-padded adm-config-card">
                    <p className="adm-config-subtitle">
                      Controla la visibilidad del chatbot en la aplicacion (solo visible para superAdmin).
                    </p>
                    <div className="adm-field adm-field-checkbox" style={{ marginTop: "1rem" }}>
                      <label className="adm-label-inline">
                        <input
                          type="checkbox"
                          checked={configDraft.chatbot_activo}
                          onChange={(e) =>
                            setConfigDraft((prev) => ({ ...prev, chatbot_activo: e.target.checked }))
                          }
                          disabled={configBusy}
                        />
                        Activar chatbot (si esta desactivado, se mostrara el boton de WhatsApp)
                      </label>
                    </div>
                    <div className="adm-actions" style={{ marginTop: "1rem" }}>
                      <button
                        className="adm-btn-primary adm-btn-inline"
                        onClick={guardarConfiguracionGeneral}
                        disabled={configBusy}
                      >
                        {configBusy ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Eventbar</h2>
              </div>
              <div className="admin-card admin-card-padded adm-config-card">
                <p className="adm-config-subtitle">
                  Crea una barra superior temporal para eventos, promociones o avisos con cuenta regresiva en dias, horas y minutos.
                </p>
                <p className="adm-inline-tip" style={{ marginTop: "0.7rem" }}>
                  La eventbar se activa automaticamente al guardar si tiene titulo y fecha final futura. Para apagarla, deja vacios el titulo o la fecha y guarda.
                </p>
                <div className="adm-config-grid adm-eventbar-grid">
                  <div className="adm-field">
                    <label className="adm-label">Titulo del evento</label>
                    <input
                      className="adm-input"
                      maxLength={120}
                      value={configDraft.eventbar_titulo}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, eventbar_titulo: event.target.value }))}
                      placeholder="Ej: Promo aniversario"
                      disabled={configBusy}
                    />
                    <p className="adm-field-help">Texto corto que aparece en la barra. Maximo 120 caracteres.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Subtitulo</label>
                    <input
                      className="adm-input"
                      maxLength={160}
                      value={configDraft.eventbar_subtitulo}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, eventbar_subtitulo: event.target.value }))}
                      placeholder="Ej: Ultimas horas - termina hoy a la medianoche"
                      disabled={configBusy}
                    />
                    <p className="adm-field-help">Segunda linea opcional para dar contexto al evento.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Finaliza el</label>
                    <input
                      className="adm-input"
                      type="datetime-local"
                      value={configDraft.eventbar_fecha_fin}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, eventbar_fecha_fin: event.target.value }))}
                      disabled={configBusy}
                    />
                    <p className="adm-field-help">Cuando llega a cero, la barra se oculta automaticamente.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Color de fondo</label>
                    <div className="adm-color-control">
                      <input
                        type="color"
                        value={normalizeHexColorInput(configDraft.eventbar_color_fondo, "#2D1A0D")}
                        onChange={(event) => setConfigDraft((prev) => ({ ...prev, eventbar_color_fondo: event.target.value }))}
                        disabled={configBusy}
                        aria-label="Color de fondo de la eventbar"
                      />
                      <input
                        className="adm-input"
                        value={configDraft.eventbar_color_fondo}
                        onChange={(event) => setConfigDraft((prev) => ({ ...prev, eventbar_color_fondo: event.target.value }))}
                        placeholder="#2D1A0D"
                        maxLength={7}
                        disabled={configBusy}
                      />
                    </div>
                    <p className="adm-field-help">Usa formato hexadecimal, por ejemplo #2D1A0D.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Color de texto</label>
                    <div className="adm-color-control">
                      <input
                        type="color"
                        value={normalizeHexColorInput(configDraft.eventbar_color_texto, "#F3C47B")}
                        onChange={(event) => setConfigDraft((prev) => ({ ...prev, eventbar_color_texto: event.target.value }))}
                        disabled={configBusy}
                        aria-label="Color de texto de la eventbar"
                      />
                      <input
                        className="adm-input"
                        value={configDraft.eventbar_color_texto}
                        onChange={(event) => setConfigDraft((prev) => ({ ...prev, eventbar_color_texto: event.target.value }))}
                        placeholder="#F3C47B"
                        maxLength={7}
                        disabled={configBusy}
                      />
                    </div>
                    <p className="adm-field-help">Conviene elegir un color con buen contraste contra el fondo.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Descuento especial</label>
                    <select
                      className="adm-input"
                      value={configDraft.eventbar_descuento_especial_tipo}
                      onChange={(event) => setConfigDraft((prev) => ({
                        ...prev,
                        eventbar_descuento_especial_tipo: normalizeEventbarDescuentoEspecialTipo(event.target.value),
                      }))}
                      disabled={configBusy}
                    >
                      {EVENTBAR_DESCUENTO_ESPECIAL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="adm-field-help">
                      {eventbarDescuentoEspecialOption.help} Solo modifica precios de venta online; no se aplica a canjes ni al catalogo de puntos.
                    </p>
                  </div>
                  <div className="adm-field adm-eventbar-preview-field">
                    <label className="adm-label">Preview</label>
                    <div
                      className="adm-eventbar-preview"
                      style={{
                        "--adm-eventbar-bg": normalizeHexColorInput(configDraft.eventbar_color_fondo, "#2D1A0D"),
                        "--adm-eventbar-fg": normalizeHexColorInput(configDraft.eventbar_color_texto, "#F3C47B"),
                      } as CSSProperties & Record<"--adm-eventbar-bg" | "--adm-eventbar-fg", string>}
                    >
                      <span className="adm-eventbar-preview-ornament adm-eventbar-preview-ornament-left" aria-hidden="true" />
                      <span className="adm-eventbar-preview-ornament adm-eventbar-preview-ornament-right" aria-hidden="true" />
                      <span className="adm-eventbar-preview-copy">
                        <span className="adm-eventbar-preview-main-icon" aria-hidden="true">
                          <svg viewBox="0 0 28 28" focusable="false">
                            <path d="M5.5 14.4 14.4 5.5h6.2v6.2l-8.9 8.9a2.2 2.2 0 0 1-3.1 0l-3.1-3.1a2.2 2.2 0 0 1 0-3.1Z" />
                            <circle cx="18.2" cy="9.8" r="1.55" />
                            <path d="m9.4 15.2 3.4 3.4" />
                          </svg>
                        </span>
                        <span className="adm-eventbar-preview-copy-text">
                          <span className="adm-eventbar-preview-title">
                            {configDraft.eventbar_titulo.trim() || "HOT SALE"}
                          </span>
                          <span className="adm-eventbar-preview-subtitle">
                            {configDraft.eventbar_subtitulo.trim() || "Ultimas horas de evento"}
                          </span>
                        </span>
                      </span>
                      <span className="adm-eventbar-preview-divider" aria-hidden="true" />
                      <span className="adm-eventbar-preview-promo">
                        <span className="adm-eventbar-preview-promo-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M7.2 8.8h9.6l-.8 10H8l-.8-10Z" />
                            <path d="M9.2 8.8a2.8 2.8 0 0 1 5.6 0" />
                          </svg>
                        </span>
                        <span>{eventbarPreviewPromoText}</span>
                      </span>
                      <span className="adm-eventbar-preview-count">
                        <span className="adm-eventbar-preview-time-card">
                          <strong>{eventbarPreviewCountdown.days}</strong>
                          <small>DIAS</small>
                        </span>
                        <span className="adm-eventbar-preview-separator">:</span>
                        <span className="adm-eventbar-preview-time-card">
                          <strong>{eventbarPreviewCountdown.hours}</strong>
                          <small>HRS</small>
                        </span>
                        <span className="adm-eventbar-preview-separator">:</span>
                        <span className="adm-eventbar-preview-time-card">
                          <strong>{eventbarPreviewCountdown.minutes}</strong>
                          <small>MIN</small>
                        </span>
                      </span>
                      <span className="adm-eventbar-preview-cta">
                        Ver promos
                        <span aria-hidden="true">&gt;</span>
                      </span>
                    </div>
                  </div>
                </div>
                {eventbarErr ? <div className="adm-msg-err">{eventbarErr}</div> : null}
                {eventbarMsg ? <div className="adm-msg-ok">{eventbarMsg}</div> : null}
                <div className="adm-config-actions">
                  <button className="adm-btn-primary adm-btn-inline" onClick={guardarEventbar} disabled={configBusy}>
                    {configBusy ? "Guardando..." : "Guardar eventbar"}
                  </button>
                </div>
              </div>

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Configuracion del programa</h2>
              </div>
              <div className="admin-card admin-card-padded adm-config-card">
                <p className="adm-config-subtitle">
                  Ajusta como se suman, vencen y se usan los puntos sin tocar codigo.
                </p>
                <div className="adm-config-highlight">
                  <span className="adm-config-highlight-label">Regla de compra actual</span>
                  <strong>
                    Cada {formatMoney(Number(configDraft.puntos_monto_base || 0))} de compra suma {Number(configDraft.puntos_por_monto || 0)} puntos.
                  </strong>
                  <p>
                    Ejemplo rapido: si una compra llega a {formatMoney(Number(configDraft.puntos_monto_base || 0) * 2)},
                    acredita {Number(configDraft.puntos_por_monto || 0) * 2} puntos.
                  </p>
                </div>
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
                    <label className="adm-label">Cada este monto de compra</label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      className="adm-input"
                      value={configDraft.puntos_monto_base}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, puntos_monto_base: event.target.value }))}
                      placeholder="Ej: 1000"
                    />
                    <p className="adm-field-help">Este es el X de la regla: cada X pesos de compra, el cliente suma puntos.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Dar estos puntos</label>
                    <input
                      type="number"
                      min={0}
                      max={1000000}
                      className="adm-input"
                      value={configDraft.puntos_por_monto}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, puntos_por_monto: event.target.value }))}
                      placeholder="Ej: 20"
                    />
                    <p className="adm-field-help">Este es el Y de la regla. Ejemplo: cada 1000 pesos, da 20 puntos.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Vencimiento de puntos</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="adm-input"
                      value={configDraft.puntos_vencimiento_meses}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, puntos_vencimiento_meses: event.target.value }))}
                      placeholder="Ej: 6"
                    />
                    <p className="adm-field-help">Meses de vigencia de cada lote nuevo. Cada carga vence segun su propia fecha.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Avisar antes del vencimiento</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="adm-input"
                      value={configDraft.puntos_alerta_pre_vencimiento_valor}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, puntos_alerta_pre_vencimiento_valor: event.target.value }))}
                      placeholder="Ej: 1"
                    />
                    <p className="adm-field-help">Define cuanta anticipacion quieres para avisar que un lote esta por vencer.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Unidad del aviso</label>
                    <select
                      className="adm-input"
                      value={configDraft.puntos_alerta_pre_vencimiento_unidad}
                      onChange={(event) => setConfigDraft((prev) => ({
                        ...prev,
                        puntos_alerta_pre_vencimiento_unidad: event.target.value === "semanas" ? "semanas" : "meses",
                      }))}
                    >
                      <option value="meses">Meses</option>
                      <option value="semanas">Semanas</option>
                    </select>
                    <p className="adm-field-help">Puedes elegir si el aviso sale meses antes o semanas antes del vencimiento.</p>
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
                  <div className="adm-field">
                    <label className="adm-label">Dias para pedidos en efectivo</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      className="adm-input"
                      value={configDraft.pedido_efectivo_dias_vigencia}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, pedido_efectivo_dias_vigencia: event.target.value }))}
                      placeholder="Ej: 3"
                    />
                    <p className="adm-field-help">Cantidad de dias que se reserva un pedido en efectivo antes de expirar si el cliente no se presenta.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Envio gratis desde</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="adm-input"
                      value={configDraft.envio_gratis_monto_minimo}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, envio_gratis_monto_minimo: event.target.value }))}
                      placeholder="Ej: 50000"
                    />
                    <p className="adm-field-help">Subtotal minimo de productos para bonificar el envio. Dejalo vacio para desactivar esta regla.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Limite compra cliente</label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      step={1}
                      className="adm-input"
                      value={configDraft.limite_compra_cliente}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, limite_compra_cliente: event.target.value }))}
                      placeholder="Ej: 100"
                    />
                    <p className="adm-field-help">Tope por producto para cliente comun. Vacio o 0 deja sin tope comercial.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Limite compra mayorista</label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      step={1}
                      className="adm-input"
                      value={configDraft.limite_compra_mayorista}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, limite_compra_mayorista: event.target.value }))}
                      placeholder="Ej: 500"
                    />
                    <p className="adm-field-help">Tope por producto para mayoristas. Vacio o 0 deja sin tope comercial.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Limite compra empleado</label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      step={1}
                      className="adm-input"
                      value={configDraft.limite_compra_empleado}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, limite_compra_empleado: event.target.value }))}
                      placeholder="Ej: 100"
                    />
                    <p className="adm-field-help">Tope por producto para empleados. Vacio o 0 deja sin tope comercial.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Dias habiles de retiro</label>
                    <input
                      className="adm-input"
                      value={configDraft.empresa_dias_habiles_retiro}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, empresa_dias_habiles_retiro: event.target.value }))}
                      placeholder="Ej: Lunes a sabado"
                    />
                    <p className="adm-field-help">Se muestra en la mini factura y en la informacion de retiro para el cliente.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Horario de retiro</label>
                    <input
                      className="adm-input"
                      value={configDraft.empresa_horario_retiro}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, empresa_horario_retiro: event.target.value }))}
                      placeholder="Ej: 08:00 a 18:00"
                    />
                    <p className="adm-field-help">Horario que acompana la sucursal en el comprobante del pedido.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Leyenda legal del comprobante</label>
                    <textarea
                      className="adm-input"
                      rows={3}
                      value={configDraft.pedido_comprobante_leyenda}
                      onChange={(event) => setConfigDraft((prev) => ({ ...prev, pedido_comprobante_leyenda: event.target.value }))}
                      placeholder="Ej: Este documento no es valido como factura."
                    />
                    <p className="adm-field-help">Aparece al final de cada mini factura dentro de Mis pedidos.</p>
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

              {isSuperAdmin ? (
                <>
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
                </>
              ) : null}

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Panel de sucursales</h2>
              </div>
              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <p className="adm-config-subtitle">
                  Gestiona altas, ediciones y activacion de sucursales desde un panel aparte para no mezclarlo con la configuracion general.
                </p>
                <div className="adm-config-actions">
                  <button className="adm-btn-primary adm-btn-inline" onClick={irAPanelSucursales}>
                    Abrir panel de sucursales
                  </button>
                </div>
              </div>

              <div className="admin-section-header adm-config-header">
                <h2 className="admin-section-title">Zonas de envio</h2>
              </div>
              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <p className="adm-config-subtitle">
                  Define los poligonos y precios que usa el checkout para cotizar envios a domicilio.
                </p>
                <div className="adm-config-actions">
                  <button className="adm-btn-primary adm-btn-inline" onClick={irAPanelEnvios}>
                    Abrir zonas de envio
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {tab === "personas-app" ? (
            <>
              <div className="admin-section-header">
                <h2 className="admin-section-title">Personas en app</h2>
              </div>

              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "1rem" }}>
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Vista simple de personas reales: si una misma persona abre varias pestañas en el mismo navegador, el sistema la agrupa en una sola fila para no duplicarla.
                </p>

                <div className="admin-stats" style={{ margin: 0 }}>
                  <div className="admin-stat-card">
                    <p className="admin-stat-label">Activos ahora</p>
                    <p className="admin-stat-value">{appPresenceSummary?.active_now ?? 0}</p>
                  </div>
                  <div className="admin-stat-card">
                    <p className="admin-stat-label">Registros recientes</p>
                    <p className="admin-stat-value">{recentPresenceData.total}</p>
                  </div>
                </div>
              </div>

              <div className="admin-section-header">
                <h2 className="admin-section-title">Activos ahora</h2>
                <span className="adm-inline-tip" style={{ margin: 0 }}>
                  Sesiones con pulso reciente en la app.
                </span>
              </div>

              <div className="admin-card">
                {appPresenceOverviewQuery.isLoading && !appPresenceOverview ? (
                  <div className="adm-empty">Cargando personas en app...</div>
                ) : (
                  <>
                    <div className="adm-mobile-list">
                      {activePresenceSessions.length === 0 ? (
                        <div className="adm-empty">No hay clientes o usuarios no registrados activos en este momento.</div>
                      ) : (
                        activePresenceSessions.map((session) => (
                          <div key={`${session.session_id}-${session.last_seen_at}`} className="adm-mobile-item">
                            <p className="adm-mobile-item-title">{formatPresencePerson(session)}</p>
                            <p><strong>Tipo:</strong> {formatPresenceTypeLabel(session.visitante_tipo)}</p>
                            <p><strong>Ingreso:</strong> {formatBuenosAiresDateTime(session.started_at)}</p>
                            <p>
                              <strong>Sigue en la app:</strong>{" "}
                              <span className={`adm-badge ${isPresenceStillActive(session.last_seen_at) ? "adm-badge-active" : "adm-badge-neutral"}`}>
                                {formatPresenceStillActive(session.last_seen_at)}
                              </span>
                            </p>
                            <p><strong>Vista actual:</strong> {formatPresenceView(session.last_path, session.page_title)}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="admin-table-wrap adm-desktop-table">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Persona</th>
                            <th>Tipo</th>
                            <th>Ingreso</th>
                            <th>Sigue en la app</th>
                            <th>Vista actual</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activePresenceSessions.length === 0 ? (
                            <tr>
                              <td colSpan={5}>
                                <div className="adm-empty">No hay clientes o usuarios no registrados activos en este momento.</div>
                              </td>
                            </tr>
                          ) : (
                            activePresenceSessions.map((session) => (
                              <tr key={`${session.session_id}-${session.last_seen_at}`}>
                                <td>{formatPresencePerson(session)}</td>
                                <td>{formatPresenceTypeLabel(session.visitante_tipo)}</td>
                                <td>
                                  {formatBuenosAiresDateTime(session.started_at)}
                                </td>
                                <td>
                                  <span className={`adm-badge ${isPresenceStillActive(session.last_seen_at) ? "adm-badge-active" : "adm-badge-neutral"}`}>
                                    {formatPresenceStillActive(session.last_seen_at)}
                                  </span>
                                </td>
                                <td>{formatPresenceView(session.last_path, session.page_title)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <PaginationControls
                      page={appPresenceActivePage}
                      totalPages={totalAppPresenceActivePages}
                      onPrev={() => setAppPresenceActivePage((prev) => Math.max(1, prev - 1))}
                      onNext={() => setAppPresenceActivePage((prev) => Math.min(totalAppPresenceActivePages, prev + 1))}
                    />
                  </>
                )}
              </div>

              <div className="admin-section-header">
                <h2 className="admin-section-title">Ultimos registros de 30 minutos</h2>
                <span className="adm-inline-tip" style={{ margin: 0 }}>
                  Historial reciente por persona, agrupado por navegador o cuenta para evitar duplicados de la misma visita.
                </span>
              </div>

              <div className="admin-card">
                <div className="adm-mobile-list">
                  {recentPresenceLogs.length === 0 ? (
                    <div className="adm-empty">Todavia no hay registros guardados.</div>
                  ) : (
                    recentPresenceLogs.map((log) => (
                      <div key={log.id} className="adm-mobile-item">
                        <p className="adm-mobile-item-title">{formatPresencePerson(log)}</p>
                        <p><strong>Tipo:</strong> {formatPresenceTypeLabel(log.visitante_tipo)}</p>
                        <p><strong>Ingreso:</strong> {formatBuenosAiresDateTime(log.first_seen_at)}</p>
                        <p>
                          <strong>Sigue en la app:</strong>{" "}
                          <span className={`adm-badge ${isPresenceStillActive(log.last_seen_at) ? "adm-badge-active" : "adm-badge-neutral"}`}>
                            {formatPresenceStillActive(log.last_seen_at)}
                          </span>
                        </p>
                        <p><strong>Vista actual:</strong> {formatPresenceView(log.last_path, log.page_title)}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="admin-table-wrap adm-desktop-table">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Persona</th>
                        <th>Tipo</th>
                        <th>Ingreso</th>
                        <th>Sigue en la app</th>
                        <th>Vista actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPresenceLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="adm-empty">Todavia no hay registros guardados.</div>
                          </td>
                        </tr>
                      ) : (
                        recentPresenceLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{formatPresencePerson(log)}</td>
                            <td>{formatPresenceTypeLabel(log.visitante_tipo)}</td>
                            <td>
                              {formatBuenosAiresDateTime(log.first_seen_at)}
                            </td>
                            <td>
                              <span className={`adm-badge ${isPresenceStillActive(log.last_seen_at) ? "adm-badge-active" : "adm-badge-neutral"}`}>
                                {formatPresenceStillActive(log.last_seen_at)}
                              </span>
                            </td>
                            <td>{formatPresenceView(log.last_path, log.page_title)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <PaginationControls
                  page={appPresenceRecentPage}
                  totalPages={totalAppPresenceRecentPages}
                  onPrev={() => setAppPresenceRecentPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setAppPresenceRecentPage((prev) => Math.min(totalAppPresenceRecentPages, prev + 1))}
                />
              </div>
            </>
          ) : null}

          {tab === "usuarios" ? (
            <>
              <div className="admin-section-header">
                <h2 className="admin-section-title">Usuarios registrados</h2>
                <button className="adm-btn-link" onClick={() => seleccionarTab("crear")}>
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
                <div className="adm-birthday-table-head">
                  <div>
                    <strong>Listado de cumpleanos</strong>
                    <span>
                      Mostrando {cumpleanosPageStart}-{cumpleanosPageEnd} de {cumpleanosProximos.length}
                    </span>
                  </div>
                  <span>Pagina {cumpleanosPage} de {totalCumpleanosPages}</span>
                </div>
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
                                {usuario.rol === "superAdmin" || (usuario.rol === "admin" && !isSuperAdmin) ? (
                                  <span style={{ color: "#8B5A30", fontSize: "0.85rem" }}>
                                    Contacta a soporte para crear o editar administradores.
                                  </span>
                                ) : (
                                  <>
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
                                  </>
                                )}
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
                                      {isSuperAdmin ? <option value="admin">Admin</option> : null}
                                    </select>
                                    <input
                                      className="adm-input"
                                      placeholder="Teléfono (opcional)"
                                      value={editUsuarioDraft.telefono}
                                      onChange={(event) => setEditUsuarioDraft((prev) => ({ ...prev, telefono: event.target.value }))}
                                    />
                                  </div>
                                  <div className="adm-form-grid" style={{ marginTop: "0.6rem" }}>
                                    <input
                                      className="adm-input"
                                      type="date"
                                      value={editUsuarioDraft.fecha_nacimiento}
                                      onChange={(event) => setEditUsuarioDraft((prev) => ({ ...prev, fecha_nacimiento: event.target.value }))}
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
                                      <select
                                        className="adm-input"
                                        value={editUsuarioDraft.tipo_cliente}
                                        onChange={(event) => setEditUsuarioDraft((prev) => ({ ...prev, tipo_cliente: event.target.value as TipoCliente }))}
                                      >
                                        <option value="cliente">Cliente</option>
                                        <option value="mayorista">Mayorista</option>
                                        <option value="empleado">Empleado</option>
                                      </select>
                                    </div>
                                  ) : null}
                                  {editUsuarioDraft.rol === "cliente" ? (
                                    <p className="adm-field-help" style={{ marginTop: "0.45rem" }}>
                                      Los descuentos de clientes se manejan por tipo y categoria desde la seccion Categorias.
                                    </p>
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

          {tab === "cumpleanos" ? (
            <>
              <div className="admin-section-header">
                <h2 className="admin-section-title">Cumpleaños</h2>
              </div>

              <div className="admin-card admin-card-padded adm-birthday-manager">
                <div className="adm-birthday-manager-hero">
                  <div className="adm-birthday-manager-copy">
                    <h3>Gestor Integral de Cumpleaños</h3>
                    <p>Configuración de alertas y vistas</p>
                  </div>
                <div className="adm-birthday-toolbar">
                  <label className="adm-birthday-window-field">
                    <span>Mostrar próximos meses</span>
                    <div className="adm-birthday-window-actions">
                      <input
                        className="adm-input"
                        type="number"
                        min={1}
                        max={12}
                        inputMode="numeric"
                        value={cumpleanosWindowMonthsDraft}
                        onChange={(event) => {
                          setCumpleanosWindowMonthsDraft(event.target.value);
                          if (errMsg) setErrMsg("");
                          if (okMsg) setOkMsg("");
                        }}
                      />
                      <button
                        type="button"
                        className="adm-btn-primary adm-btn-inline"
                        onClick={guardarCumpleanosWindowMonths}
                      >
                        Guardar
                      </button>
                    </div>
                  </label>
                  <label className="adm-birthday-window-field">
                    <span>Avisar con días</span>
                    <div className="adm-birthday-window-actions">
                      <input
                        className="adm-input"
                        type="number"
                        min={1}
                        max={90}
                        inputMode="numeric"
                        value={cumpleanosAlertDaysDraft}
                        onChange={(event) => {
                          setCumpleanosAlertDaysDraft(event.target.value);
                          if (errMsg) setErrMsg("");
                          if (okMsg) setOkMsg("");
                        }}
                      />
                      <button
                        type="button"
                        className="adm-btn-primary adm-btn-inline"
                        onClick={guardarCumpleanosAlertDays}
                      >
                        Guardar
                      </button>
                    </div>
                  </label>
                  <div className="adm-birthday-range-note">
                    <strong>Rango actual</strong>
                    <span>Desde hoy hasta {formatDateStamp(cumpleanosWindowEndStamp)}. Badge y aviso manual: {cumpleanosAlertDays} días antes.</span>
                  </div>
                </div>
                  <div className="adm-birthday-manager-actions">
                    <button type="button" className="adm-btn-primary adm-birthday-save-btn" onClick={guardarCumpleanosConfig}>
                      Guardar cambios
                    </button>
                  </div>
                </div>

                <p className="adm-field-help" style={{ margin: 0 }}>
                  El sistema calcula la próxima fecha de cumpleaños según la fecha de nacimiento de cada usuario activo. Si el cliente tiene teléfono cargado, puedes abrir su WhatsApp con el mensaje listo.
                </p>

                <div className="adm-birthday-summary-grid">
                  <article className="adm-birthday-summary-card">
                    <span>Cumplen hoy</span>
                    <strong>{cumpleanosHoy.length}</strong>
                  </article>
                  <article className="adm-birthday-summary-card">
                    <span>En el rango elegido</span>
                    <strong>{cumpleanosProximos.length}</strong>
                  </article>
                  <article className="adm-birthday-summary-card">
                    <span>Para avisar</span>
                    <strong>{cumpleanosPorAvisarConWhatsapp.length}</strong>
                  </article>
                  <article className="adm-birthday-summary-card">
                    <span>Sin fecha cargada</span>
                    <strong>{usuariosSinFechaNacimiento}</strong>
                  </article>
                  <article className="adm-birthday-summary-card adm-birthday-summary-card-whatsapp">
                    <span>Recordatorios de WhatsApp</span>
                    <strong>{cumpleanosPorAvisarConWhatsapp.length} pendientes</strong>
                  </article>
                </div>

                {cumpleanosPorAvisarConWhatsapp.length ? (
                  <div className="adm-birthday-today-box">
                    <div>
                      <strong>Clientes para avisar por WhatsApp</strong>
                      <p>
                        {cumpleanosPorAvisarConWhatsapp
                          .slice(0, 4)
                          .map((item) => `${item.usuario.nombre} (${formatBirthdayCountdownLabel(item.daysUntil)})`)
                          .join(", ")}
                        {cumpleanosPorAvisarConWhatsapp.length > 4 ? ` y ${cumpleanosPorAvisarConWhatsapp.length - 4} más.` : ""}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="adm-empty">No hay clientes con cumpleaños próximos dentro del aviso configurado.</div>
                )}
              </div>

              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Próximo cumpleaños</th>
                        <th>Faltan</th>
                        <th>Datos</th>
                        <th>Accion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cumpleanosPagina.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="adm-empty">No hay cumpleaños dentro del rango elegido.</div>
                          </td>
                        </tr>
                      ) : null}
                      {cumpleanosPagina.map((item) => {
                        const clientPhone = normalizeWhatsAppPhone(item.usuario.telefono);
                        const whatsappMessage = buildBirthdayCustomerWhatsAppMessage(item);
                        const whatsappUrl = clientPhone ? buildWhatsAppUrl(clientPhone, whatsappMessage) : "";
                        return (
                          <tr key={`cumpleanos-${item.usuario.id}`}>
                            <td>
                              <div className="adm-birthday-name-cell">
                                <strong>{item.usuario.nombre}</strong>
                                <span>{formatRolLabel(item.usuario.rol)}</span>
                              </div>
                            </td>
                            <td>
                              <div className="adm-birthday-date-cell">
                                <strong>{formatDateStamp(item.nextBirthdayStamp)}</strong>
                                {item.nextAge ? <span>Cumple {item.nextAge} años</span> : null}
                              </div>
                            </td>
                            <td>
                              <span className={`adm-birthday-days-badge${item.isToday ? " is-today" : ""}`}>
                                {formatBirthdayCountdownLabel(item.daysUntil)}
                              </span>
                            </td>
                            <td>
                              <div className="adm-birthday-meta-cell">
                                <span>{item.usuario.telefono?.trim() || item.usuario.email}</span>
                                <span>{[item.usuario.localidad, item.usuario.provincia].filter(Boolean).join(", ") || "-"}</span>
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="adm-btn-secondary"
                                style={{ width: "auto" }}
                                disabled={!whatsappUrl}
                                onClick={() => window.open(whatsappUrl, "_blank", "noopener,noreferrer")}
                              >
                                {whatsappUrl ? "WhatsApp cliente" : "Sin WhatsApp"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={cumpleanosPage}
                  totalPages={totalCumpleanosPages}
                  onPrev={() => setCumpleanosPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setCumpleanosPage((prev) => Math.min(totalCumpleanosPages, prev + 1))}
                />
              </div>
            </>
          ) : null}

          {tab === "productos" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Listado de productos" />
              <div className="adm-list-search" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  className="adm-input"
                  style={{ flex: "1", minWidth: "200px" }}
                  placeholder="Buscar producto por nombre, categoria, descripcion o puntos..."
                  value={busquedaProductos}
                  onChange={(event) => setBusquedaProductos(event.target.value)}
                />
                <select
                  className="adm-input"
                  style={{ width: "auto", minWidth: "160px", flex: "0 0 auto" }}
                  value={filtroTipoProducto}
                  onChange={(event) => { setFiltroTipoProducto(event.target.value); setProductosPage(1); }}
                >
                  <option value="">Todos los tipos</option>
                  <option value="canje">Solo canje</option>
                  <option value="venta">Solo tienda</option>
                  <option value="mixto">Mixto</option>
                </select>
                <button className="adm-btn-secondary adm-btn-inline" onClick={() => abrirVistaProductos("productos-crear")}>
                  Crear producto
                </button>
              </div>
              <div className="admin-card">
                {productosFiltrados.length === 0 ? <div className="adm-empty">No hay productos que coincidan con la busqueda.</div> : null}
                {productosPagina.map((producto) => (
                  <div key={producto.id} className="adm-product-row">
                    <div className="admin-producto-resumen">
                      <div>
                        <p className="admin-producto-title">{producto.nombre}</p>
                        <p className="admin-producto-sub">
                          {formatTipoProducto(producto.tipo_producto)} - {producto.categoria || "Sin categoria"}
                          {producto.tipo_producto === "venta" || producto.tipo_producto === "mixto" ? ` - ${formatMoney(producto.precio_dinero)}` : ""}
                          {producto.tipo_producto === "canje" || producto.tipo_producto === "mixto" || !producto.tipo_producto ? ` - ${producto.puntos_para_canjear ?? producto.precio_puntos ?? producto.puntos_requeridos} pts` : ""}
                        </p>
                        <p className="admin-producto-sub">
                          Stock: {producto.track_stock === false ? "Sin control" : `${producto.stock_disponible ?? 0} disp. / ${producto.stock_reservado ?? 0} reservado`}
                        </p>
                        {producto.configuracion_tipo === "caja_sabores" ? (
                          <p className="admin-producto-sub">
                            Caja configurable: {producto.capacidad_sabores ?? 0} alfajores | Sabores: {producto.sabores?.map((sabor) => sabor.nombre).join(", ") || "Sin sabores"}
                          </p>
                        ) : null}
                        <p className="admin-producto-sub">Imagenes: {producto.imagenes?.length ?? (producto.imagen_url ? 1 : 0)} / {MAX_PRODUCT_IMAGES}</p>
                      </div>
                      <div className="admin-producto-actions">
                        <button
                          className="adm-btn-link"
                          onClick={() => {
                            startEdit(producto);
                            abrirVistaProductos("productos-edicion");
                          }}
                        >
                          Editar
                        </button>
                        <button className={producto.activo ? "adm-btn-danger" : "adm-btn-success"} onClick={() => toggleProductoActivo(producto)}>
                          {producto.activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </div>
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

          {tab === "productos-sabores" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Sabores de alfajores" />

              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <p className="adm-inline-tip">
                  Carga los sabores una sola vez y luego usalos en productos tipo Caja configurable. El stock se descuenta por sabor.
                </p>
                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label className="adm-label">Nombre del sabor</label>
                    <input
                      className="adm-input"
                      placeholder="Ej: Chocolate, Maicena, Coco"
                      value={nuevoSabor.nombre}
                      onChange={(event) => setNuevoSabor((prev) => ({ ...prev, nombre: event.target.value }))}
                    />
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Descripcion</label>
                    <input
                      className="adm-input"
                      value={nuevoSabor.descripcion}
                      onChange={(event) => setNuevoSabor((prev) => ({ ...prev, descripcion: event.target.value }))}
                    />
                  </div>
                </div>
                <ProductInventoryEditor
                  sucursales={sucursales}
                  values={nuevoSabor.inventario_sucursales}
                  tip="Stock disponible de este sabor por sucursal. Las cajas personalizadas usan este stock."
                  onChangeStock={(sucursalId, stock) =>
                    setNuevoSabor((prev) => ({
                      ...prev,
                      inventario_sucursales: {
                        ...prev.inventario_sucursales,
                        [String(sucursalId)]: stock,
                      },
                    }))
                  }
                />
                <button className="adm-btn-primary" disabled={busy} onClick={crearSabor}>
                  {busy ? "Creando..." : "Crear sabor"}
                </button>
                <div className="adm-product-options">
                  {sabores.map((sabor) => (
                    <div key={sabor.id} className="adm-check-row" style={{ alignItems: "flex-start", flexDirection: "column" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", width: "100%" }}>
                        <strong>{sabor.nombre}</strong>
                        <button className={sabor.activo ? "adm-btn-danger" : "adm-btn-success"} onClick={() => toggleSaborActivo(sabor)}>
                          {sabor.activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        {(sabor.inventario_sucursales ?? []).map((row) => (
                          <label key={`${sabor.id}-${row.sucursal_id}`} style={{ display: "grid", gap: "0.2rem", minWidth: "150px" }}>
                            <span>{row.sucursal_nombre} ({row.stock_reservado} reservado)</span>
                            <input
                              className="adm-input"
                              type="number"
                              min={row.stock_reservado}
                              defaultValue={emptyZeroInputValue(row.stock_disponible)}
                              placeholder="0"
                              onBlur={(event) => void actualizarStockSabor(sabor, row.sucursal_id, Number(event.target.value))}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : null}

          {tab === "productos-crear" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Nuevo producto" />

              <div className="admin-card admin-card-padded" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label className="adm-label">Nombre</label>
                    <input className="adm-input" value={nuevoProducto.nombre} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, nombre: event.target.value }))} />
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Codigo interno (SKU)</label>
                    <input className="adm-input" placeholder="Ej: REM-001 (opcional)" value={nuevoProducto.sku} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, sku: event.target.value }))} />
                    <p className="adm-field-help">Es un codigo propio para identificar productos en stock, reportes o busquedas. Puede quedar vacio.</p>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Categoria</label>
                    <select className="adm-input" value={nuevoProducto.categoria} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, categoria: event.target.value }))}>
                      <option value="">Sin categoria</option>
                      {categoriasActivas.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Tipo de producto</label>
                    <select className="adm-input" value={nuevoProducto.tipo_producto} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, tipo_producto: event.target.value as ProductoForm["tipo_producto"] }))}>
                      <option value="canje">Solo canje</option>
                      <option value="venta">Solo venta online</option>
                      <option value="mixto">Venta y canje</option>
                    </select>
                  </div>
                </div>

                <div className="adm-field">
                  <label className="adm-label">Descripcion</label>
                  <textarea className="adm-input" value={nuevoProducto.descripcion} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, descripcion: event.target.value }))} />
                </div>

                <div className="adm-form-grid">
                  {(nuevoProducto.tipo_producto === "venta" || nuevoProducto.tipo_producto === "mixto") ? (
                    <div className="adm-field">
                      <label className="adm-label">Precio venta</label>
                      <input type="number" min={1} className="adm-input" value={nuevoProducto.precio_dinero ?? ""} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, precio_dinero: event.target.value ? Number(event.target.value) : null }))} />
                    </div>
                  ) : null}
                  {(nuevoProducto.tipo_producto === "canje" || nuevoProducto.tipo_producto === "mixto") ? (
                    <div className="adm-field">
                      <label className="adm-label">Puntos para canjear</label>
                      <input type="number" min={1} className="adm-input" value={nuevoProducto.puntos_requeridos ?? ""} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, puntos_requeridos: event.target.value ? Number(event.target.value) : null }))} />
                    </div>
                  ) : null}
                </div>

                <div className="adm-product-options">
                  <label className="adm-check-row">
                    <input type="checkbox" checked={nuevoProducto.destacado_home} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, destacado_home: event.target.checked }))} />
                    Mostrar en destacados del home
                  </label>
                  <label className="adm-check-row">
                    <input type="checkbox" checked={nuevoProducto.track_stock} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, track_stock: event.target.checked }))} />
                    Controlar stock
                  </label>
                  <label className="adm-check-row">
                    <input type="checkbox" checked={nuevoProducto.permite_retiro_local} onChange={(event) => setNuevoProducto((prev) => ({ ...prev, permite_retiro_local: event.target.checked }))} />
                    Retiro en sucursal
                  </label>
                  <label className="adm-check-row">
                    <input
                      type="checkbox"
                      checked={nuevoProducto.permite_envio}
                      onChange={(event) => setNuevoProducto((prev) => ({ ...prev, permite_envio: event.target.checked, envio_gratis: event.target.checked ? prev.envio_gratis : false }))}
                    />
                    Permite envio
                  </label>
                  <label className="adm-check-row">
                    <input
                      type="checkbox"
                      checked={nuevoProducto.envio_gratis}
                      onChange={(event) => setNuevoProducto((prev) => ({ ...prev, envio_gratis: event.target.checked, permite_envio: event.target.checked ? true : prev.permite_envio }))}
                    />
                    Envio gratis
                  </label>
                </div>

                <div className="admin-card admin-card-padded" style={{ background: "#fffaf2", gap: "0.8rem" }}>
                  <label className="adm-check-row">
                    <input
                      type="checkbox"
                      checked={nuevoProducto.configuracion_tipo === "caja_sabores"}
                      onChange={(event) =>
                        setNuevoProducto((prev) => ({
                          ...prev,
                          configuracion_tipo: event.target.checked ? "caja_sabores" : "simple",
                          track_stock: event.target.checked ? false : prev.track_stock,
                        }))
                      }
                    />
                    Es una caja configurable por sabores
                  </label>
                  {nuevoProducto.configuracion_tipo === "caja_sabores" ? (
                    <>
                      <div className="adm-field">
                        <label className="adm-label">Cantidad de alfajores por caja</label>
                        <input
                          type="number"
                          min={1}
                          className="adm-input"
                          value={nuevoProducto.capacidad_sabores ?? ""}
                          onChange={(event) => setNuevoProducto((prev) => ({ ...prev, capacidad_sabores: event.target.value ? Number(event.target.value) : null }))}
                        />
                      </div>
                      <div className="adm-field">
                        <label className="adm-label">Sabores permitidos</label>
                        <div className="adm-product-options">
                          {sabores.map((sabor) => (
                            <label key={sabor.id} className="adm-check-row">
                              <input
                                type="checkbox"
                                checked={nuevoProducto.sabor_ids.includes(sabor.id)}
                                onChange={() => toggleSaborProducto("nuevo", sabor.id)}
                              />
                              {sabor.nombre}
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                {nuevoProducto.track_stock && nuevoProducto.configuracion_tipo !== "caja_sabores" ? (
                  <ProductInventoryEditor
                    sucursales={sucursales}
                    values={nuevoProducto.inventario_sucursales}
                    tip="Carga cuanto stock disponible tiene este producto en cada sucursal activa. Si dejas una sucursal en 0, el cliente no podra retirar ese producto ahi."
                    onChangeStock={(sucursalId, stock) =>
                      setNuevoProducto((prev) => ({
                        ...prev,
                        inventario_sucursales: {
                          ...prev.inventario_sucursales,
                          [String(sucursalId)]: stock,
                        },
                      }))
                    }
                  />
                ) : null}

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
                      accept={IMAGE_FILE_ACCEPT}
                      style={{ display: "none" }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void subirImagenProducto(file, "nuevo");
                      }}
                    />
                  </label>
                </div>

                <div className="adm-inline-tip">Puedes cargar hasta 3 imágenes. La primera se usa como portada del catálogo en PC y recomendamos formato 16:9.</div>
                {nuevoProducto.imagenes.length ? (
                  <div className="adm-product-images-grid">
                    {nuevoProducto.imagenes.map((url, index) => (
                      <div key={`${url}-${index}`} className="adm-product-image-card">
                        <img src={mediaUrl(url)} className="adm-product-image-thumb" alt={`Imagen ${index + 1}`} />
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

                <div className="adm-field">
                  <FieldLabel text="Imagen Cuadrada (Móvil)" tip="Esta imagen se mostrará en el catálogo cuando el usuario ingrese desde un celular (formato 1:1)." />
                  <div className="adm-upload" style={{ minHeight: "80px", padding: "1rem" }}>
                    {nuevoProducto.imagen_mobile_url ? (
                      <div className="adm-product-image-card" style={{ width: "fit-content" }}>
                        <img src={mediaUrl(nuevoProducto.imagen_mobile_url)} className="adm-product-image-thumb" alt="Imagen Móvil" style={{ width: "80px", height: "80px", objectFit: "cover" }} />
                        <div className="adm-product-image-row">
                          <span>Imagen Móvil</span>
                          <button type="button" className="adm-btn-danger" onClick={() => quitarImagenMobileProducto("nuevo")}>
                            Quitar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="adm-btn-secondary adm-btn-inline" style={{ cursor: "pointer", width: "auto" }}>
                        Cargar imagen móvil
                        <input
                          type="file"
                          accept={IMAGE_FILE_ACCEPT}
                          style={{ display: "none" }}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void subirImagenMobileProducto(file, "nuevo");
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <button className="adm-btn-primary" disabled={busy} onClick={crearProducto}>
                  {busy ? "Creando..." : "Crear producto"}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "productos-edicion" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Editar producto" />
              <div className="adm-list-search" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  className="adm-input"
                  style={{ flex: "1", minWidth: "200px" }}
                  placeholder="Buscar producto por nombre, categoria, descripcion o puntos..."
                  value={busquedaProductos}
                  onChange={(event) => setBusquedaProductos(event.target.value)}
                />
                <select
                  className="adm-input"
                  style={{ width: "auto", minWidth: "160px", flex: "0 0 auto" }}
                  value={filtroTipoProducto}
                  onChange={(event) => { setFiltroTipoProducto(event.target.value); setProductosPage(1); }}
                >
                  <option value="">Todos los tipos</option>
                  <option value="canje">Solo canje</option>
                  <option value="venta">Solo tienda</option>
                  <option value="mixto">Mixto</option>
                </select>
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
                            <FieldLabel text="Codigo interno (SKU)" tip="SKU significa Stock Keeping Unit: un codigo propio opcional para identificar este producto en stock, reportes y busquedas." />
                            <input
                              className="adm-input"
                              value={editDraft.sku}
                              onChange={(event) => setEditDraft((prev) => ({ ...prev, sku: event.target.value }))}
                              placeholder="Ej: REM-001 (opcional)"
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
                              {categoriasProductoEdit.map((c) => (
                                <option key={c.id} value={c.nombre}>
                                  {c.activo === false ? `${c.nombre} (inactiva)` : c.nombre}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="adm-field">
                            <FieldLabel text="Tipo de producto" tip="Define si aparece en canjes, tienda online o en ambas experiencias." />
                            <select
                              className="adm-input"
                              value={editDraft.tipo_producto}
                              onChange={(event) => setEditDraft((prev) => ({ ...prev, tipo_producto: event.target.value as ProductoForm["tipo_producto"] }))}
                            >
                              <option value="canje">Solo canje</option>
                              <option value="venta">Solo venta online</option>
                              <option value="mixto">Venta y canje</option>
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
                          {(editDraft.tipo_producto === "venta" || editDraft.tipo_producto === "mixto") ? (
                            <div className="adm-field">
                              <FieldLabel text="Precio venta" tip="Precio en pesos para Tienda Online." />
                              <input
                                type="number"
                                min={1}
                                className="adm-input"
                                value={editDraft.precio_dinero ?? ""}
                                onChange={(event) => setEditDraft((prev) => ({ ...prev, precio_dinero: event.target.value ? Number(event.target.value) : null }))}
                              />
                            </div>
                          ) : null}
                          {(editDraft.tipo_producto === "canje" || editDraft.tipo_producto === "mixto") ? (
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
                          ) : null}
                        </div>

                        <div className="adm-product-options">
                          <label className="adm-check-row">
                            <input type="checkbox" checked={editDraft.destacado_home} onChange={(event) => setEditDraft((prev) => ({ ...prev, destacado_home: event.target.checked }))} />
                            Mostrar en destacados del home
                          </label>
                          <label className="adm-check-row">
                            <input type="checkbox" checked={editDraft.track_stock} onChange={(event) => setEditDraft((prev) => ({ ...prev, track_stock: event.target.checked }))} />
                            Controlar stock
                          </label>
                          <label className="adm-check-row">
                            <input type="checkbox" checked={editDraft.permite_retiro_local} onChange={(event) => setEditDraft((prev) => ({ ...prev, permite_retiro_local: event.target.checked }))} />
                            Retiro en sucursal
                          </label>
                          <label className="adm-check-row">
                            <input
                              type="checkbox"
                              checked={editDraft.permite_envio}
                              onChange={(event) => setEditDraft((prev) => ({ ...prev, permite_envio: event.target.checked, envio_gratis: event.target.checked ? prev.envio_gratis : false }))}
                            />
                            Permite envio
                          </label>
                          <label className="adm-check-row">
                            <input
                              type="checkbox"
                              checked={editDraft.envio_gratis}
                              onChange={(event) => setEditDraft((prev) => ({ ...prev, envio_gratis: event.target.checked, permite_envio: event.target.checked ? true : prev.permite_envio }))}
                            />
                            Envio gratis
                          </label>
                        </div>

                        <div className="admin-card admin-card-padded" style={{ background: "#fffaf2", gap: "0.8rem" }}>
                          <label className="adm-check-row">
                            <input
                              type="checkbox"
                              checked={editDraft.configuracion_tipo === "caja_sabores"}
                              onChange={(event) =>
                                setEditDraft((prev) => ({
                                  ...prev,
                                  configuracion_tipo: event.target.checked ? "caja_sabores" : "simple",
                                  track_stock: event.target.checked ? false : prev.track_stock,
                                }))
                              }
                            />
                            Es una caja configurable por sabores
                          </label>
                          {editDraft.configuracion_tipo === "caja_sabores" ? (
                            <>
                              <div className="adm-field">
                                <FieldLabel text="Cantidad de alfajores por caja" tip="Ej: 3 o 6. El cliente debera elegir exactamente esa cantidad de sabores." />
                                <input
                                  type="number"
                                  min={1}
                                  className="adm-input"
                                  value={editDraft.capacidad_sabores ?? ""}
                                  onChange={(event) => setEditDraft((prev) => ({ ...prev, capacidad_sabores: event.target.value ? Number(event.target.value) : null }))}
                                />
                              </div>
                              <div className="adm-field">
                                <FieldLabel text="Sabores permitidos" tip="Estos sabores aparecen como opciones al personalizar la caja." />
                                <div className="adm-product-options">
                                  {sabores.map((sabor) => (
                                    <label key={sabor.id} className="adm-check-row">
                                      <input
                                        type="checkbox"
                                        checked={editDraft.sabor_ids.includes(sabor.id)}
                                        onChange={() => toggleSaborProducto("edit", sabor.id)}
                                      />
                                      {sabor.nombre}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </>
                          ) : null}
                        </div>

                        {editDraft.track_stock && editDraft.configuracion_tipo !== "caja_sabores" ? (
                          <ProductInventoryEditor
                            sucursales={sucursales}
                            values={editDraft.inventario_sucursales}
                            rows={inventarioPorProducto.get(producto.id)}
                            tip="Ajusta stock disponible por sucursal. Reservado se muestra solo para control y se mueve con compras, canjes y expiraciones."
                            onChangeStock={(sucursalId, stock) =>
                              setEditDraft((prev) => ({
                                ...prev,
                                inventario_sucursales: {
                                  ...prev.inventario_sucursales,
                                  [String(sucursalId)]: stock,
                                },
                              }))
                            }
                          />
                        ) : null}

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
                              accept={IMAGE_FILE_ACCEPT}
                              style={{ display: "none" }}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = "";
                                if (file) void subirImagenProducto(file, "edit");
                              }}
                            />
                          </label>
                        </div>

                        <div className="adm-inline-tip">Ordena tus imágenes quitando y volviendo a cargar. La primera se muestra como portada en PC y recomendamos formato 16:9.</div>
                        {editDraft.imagenes.length ? (
                          <div className="adm-product-images-grid">
                            {editDraft.imagenes.map((url, index) => (
                              <div key={`${url}-${index}`} className="adm-product-image-card">
                                <img src={mediaUrl(url)} className="adm-product-image-thumb" alt={`Imagen ${index + 1}`} />
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

                        <div className="adm-field">
                          <FieldLabel text="Imagen Cuadrada (Móvil)" tip="Esta imagen se mostrará en el catálogo cuando el usuario ingrese desde un celular (formato 1:1)." />
                          <div className="adm-upload" style={{ minHeight: "80px", padding: "1rem" }}>
                            {editDraft.imagen_mobile_url ? (
                              <div className="adm-product-image-card" style={{ width: "fit-content" }}>
                                <img src={mediaUrl(editDraft.imagen_mobile_url)} className="adm-product-image-thumb" alt="Imagen Móvil" style={{ width: "80px", height: "80px", objectFit: "cover" }} />
                                <div className="adm-product-image-row">
                                  <span>Imagen Móvil</span>
                                  <button type="button" className="adm-btn-danger" onClick={() => quitarImagenMobileProducto("edit")}>
                                    Quitar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <label className="adm-btn-secondary adm-btn-inline" style={{ cursor: "pointer", width: "auto" }}>
                                Cargar imagen móvil
                                <input
                                  type="file"
                                  accept={IMAGE_FILE_ACCEPT}
                                  style={{ display: "none" }}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.currentTarget.value = "";
                                    if (file) void subirImagenMobileProducto(file, "edit");
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </div>


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
                            {formatTipoProducto(producto.tipo_producto)} - {producto.categoria || "Sin categoria"}
                            {producto.tipo_producto === "venta" || producto.tipo_producto === "mixto" ? ` - ${formatMoney(producto.precio_dinero)}` : ""}
                            {producto.tipo_producto === "canje" || producto.tipo_producto === "mixto" || !producto.tipo_producto ? ` - ${producto.puntos_para_canjear ?? producto.precio_puntos ?? producto.puntos_requeridos} pts` : ""}
                          </p>
                          <p className="admin-producto-sub">
                            Stock: {producto.track_stock === false ? "Sin control" : `${producto.stock_disponible ?? 0} disp. / ${producto.stock_reservado ?? 0} reservado`}
                          </p>
                          {producto.configuracion_tipo === "caja_sabores" ? (
                            <p className="admin-producto-sub">
                              Caja configurable: {producto.capacidad_sabores ?? 0} alfajores | Sabores: {producto.sabores?.map((sabor) => sabor.nombre).join(", ") || "Sin sabores"}
                            </p>
                          ) : null}
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

          {tab === "inventario" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Inventario por sucursal" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.85rem" }}>
                <div className="adm-form-grid">
                  <input className="adm-input" placeholder="Buscar producto, codigo interno o sucursal..." value={busquedaInventario} onChange={(event) => setBusquedaInventario(event.target.value)} />
                  <select className="adm-input" value={inventarioFiltroSucursal} onChange={(event) => setInventarioFiltroSucursal(event.target.value)}>
                    <option value="">Todas las sucursales</option>
                    {sucursales.map((sucursal) => <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>)}
                  </select>
                  <select className="adm-input" value={inventarioFiltroProducto} onChange={(event) => setInventarioFiltroProducto(event.target.value)}>
                    <option value="">Todos los productos</option>
                    {productos.map((producto) => <option key={producto.id} value={producto.id}>{producto.nombre}</option>)}
                  </select>
                  <button className="adm-btn-secondary" onClick={() => void expirarReservas()} disabled={busy}>
                    Revisar reservas vencidas
                  </button>
                </div>
                <p className="adm-inline-tip">Disponible se puede ajustar manualmente. Reservado cambia con compras, canjes, cancelaciones y expiraciones.</p>
              </div>

              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Sucursal</th>
                        <th>Tipo</th>
                        <th>Disponible</th>
                        <th>Reservado</th>
                        <th>Actualizar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventarioPagina.length === 0 ? (
                        <tr><td colSpan={6}><div className="adm-empty">No hay inventario para mostrar.</div></td></tr>
                      ) : null}
                      {inventarioPagina.map((row) => {
                        const key = `${row.producto_id}:${row.sucursal_id}`;
                        return (
                          <tr key={row.id}>
                            <td>
                              {row.producto_nombre}
                              <br />
                              <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{row.sku ? `Codigo: ${row.sku}` : "Sin codigo interno"}</span>
                            </td>
                            <td>{row.sucursal_nombre}</td>
                            <td>{formatTipoProducto(row.tipo_producto)}</td>
                            <td style={{ minWidth: 120 }}>
                              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                                <button className="adm-btn-link" type="button" onClick={() => ajustarInventarioRapido(row, -5)} disabled={busy}>-5</button>
                                <button className="adm-btn-link" type="button" onClick={() => ajustarInventarioRapido(row, -1)} disabled={busy}>-1</button>
                                <button className="adm-btn-link" type="button" onClick={() => ajustarInventarioRapido(row, 1)} disabled={busy}>+1</button>
                                <button className="adm-btn-link" type="button" onClick={() => ajustarInventarioRapido(row, 5)} disabled={busy}>+5</button>
                              </div>
                              <input
                                type="number"
                                min={0}
                                className="adm-input"
                                value={inventarioDraft[key] ?? emptyZeroInputValue(row.stock_disponible)}
                                placeholder="0"
                                onChange={(event) => setInventarioDraft((prev) => ({ ...prev, [key]: event.target.value }))}
                              />
                            </td>
                            <td><strong>{row.stock_reservado}</strong></td>
                            <td>
                              <button className="adm-btn-link" onClick={() => void guardarAjusteInventario(row)} disabled={busy}>
                                Guardar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={inventarioPage}
                  totalPages={totalInventarioPages}
                  onPrev={() => setInventarioPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setInventarioPage((prev) => Math.min(totalInventarioPages, prev + 1))}
                />
              </div>

              <SectionTitle title="Kardex de stock" />
              <AreaExplanation items={KARDEX_STOCK_EXPLANATION} defaultOpen={false} />
              <div className="admin-card">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Producto</th>
                        <th>Sucursal</th>
                        <th>Orden</th>
                        <th>Movimiento</th>
                        <th>Cantidad</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimientosStock.slice(0, 12).length === 0 ? (
                        <tr><td colSpan={7}><div className="adm-empty">Aun no hay movimientos de stock.</div></td></tr>
                      ) : null}
                      {movimientosStock.slice(0, 12).map((mov) => (
                        <tr key={mov.id}>
                          <td>{formatDate(mov.created_at)}</td>
                          <td>{mov.producto_nombre}</td>
                          <td>{mov.sucursal_nombre || "-"}</td>
                          <td>{mov.orden_id ? `#${mov.orden_id}` : "-"}</td>
                          <td>{mov.tipo} / {mov.origen}</td>
                          <td className={mov.tipo === "liberacion" || mov.tipo === "ingreso" ? "adm-pts-pos" : "adm-pts-neg"}>{mov.cantidad}</td>
                          <td>{mov.descripcion || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "postulaciones" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Postulaciones recibidas" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.85rem" }}>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    className="adm-input"
                    placeholder="Buscar por nombre, email, telefono, archivo o mensaje..."
                    value={busquedaPostulaciones}
                    onChange={(event) => {
                      setBusquedaPostulaciones(event.target.value);
                      setPostulacionesPage(1);
                    }}
                    style={{ flex: "1 1 260px" }}
                  />
                  <button
                    type="button"
                    className="adm-btn-secondary"
                    onClick={() => void limpiarPostulaciones()}
                    disabled={busy || postulacionesFiltradas.length === 0}
                    style={{ width: "auto", whiteSpace: "nowrap" }}
                  >
                    Limpiar listado
                  </button>
                </div>
                <p className="adm-inline-tip">Se muestran los ultimos CV enviados desde el home. La descarga requiere sesion de administrador.</p>
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Pagina {postulacionesPage} de {totalPostulacionesPages}. {postulacionesFiltradas.length} postulante{postulacionesFiltradas.length === 1 ? "" : "s"} visible{postulacionesFiltradas.length === 1 ? "" : "s"}.
                </p>
              </div>

              <div className="admin-card">
                <div className="admin-table-wrap adm-desktop-table">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Postulante</th>
                        <th>Contacto</th>
                        <th>Mensaje</th>
                        <th>Archivo</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {postulacionesPagina.length === 0 ? (
                        <tr><td colSpan={6}><div className="adm-empty">No hay postulaciones para mostrar.</div></td></tr>
                      ) : null}
                      {postulacionesPagina.map((postulacion) => (
                        <tr key={postulacion.id}>
                          <td>{formatDate(postulacion.created_at)}</td>
                          <td>
                            <strong>{postulacion.nombre}</strong>
                            <br />
                            <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{postulacion.estado}</span>
                          </td>
                          <td>
                            {postulacion.email}
                            <br />
                            <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{postulacion.telefono || "Sin telefono"}</span>
                          </td>
                          <td className="adm-cell-muted">{postulacion.mensaje}</td>
                          <td>
                            {postulacion.archivo_original}
                            <br />
                            <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{Math.max(1, Math.round(Number(postulacion.size_bytes || 0) / 1024))} KB</span>
                            {postulacion.archivo_disponible === false ? (
                              <>
                                <br />
                                <span style={{ color: "#B42318", fontSize: "0.75rem", fontWeight: 700 }}>Archivo no disponible</span>
                              </>
                            ) : null}
                          </td>
                          <td>
                            <button className="adm-btn-link" onClick={() => void descargarCvPostulacion(postulacion)} disabled={busy || postulacion.archivo_disponible === false}>
                              {postulacion.archivo_disponible === false ? "No disponible" : "Descargar CV"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="adm-mobile-list">
                  {postulacionesPagina.length === 0 ? <div className="adm-empty">No hay postulaciones para mostrar.</div> : null}
                  {postulacionesPagina.map((postulacion) => (
                    <div className="adm-mobile-item" key={postulacion.id}>
                      <p className="adm-mobile-item-title">{postulacion.nombre}</p>
                      <p>{postulacion.email}</p>
                      <p>{postulacion.telefono || "Sin telefono"} - {formatDate(postulacion.created_at)}</p>
                      <p>{postulacion.mensaje}</p>
                      {postulacion.archivo_disponible === false ? (
                        <p style={{ margin: "0.35rem 0", color: "#B42318", fontWeight: 700 }}>Archivo no disponible</p>
                      ) : null}
                      <button className="adm-btn-link" onClick={() => void descargarCvPostulacion(postulacion)} disabled={busy || postulacion.archivo_disponible === false}>
                        {postulacion.archivo_disponible === false ? "No disponible" : "Descargar CV"}
                      </button>
                    </div>
                  ))}
                </div>

                <PaginationControls
                  page={postulacionesPage}
                  totalPages={totalPostulacionesPages}
                  onPrev={() => setPostulacionesPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setPostulacionesPage((prev) => Math.min(totalPostulacionesPages, prev + 1))}
                />
              </div>
            </div>
          ) : null}

          {tab === "ordenes" ? (
            <AdminVentasView
              currentView={ventasView}
              pedidosContent={
                <>
                  <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.85rem" }}>
                    <div className="adm-form-grid">
                      <input className="adm-input" placeholder="Buscar por cliente, orden, estado o pago..." value={busquedaOrdenes} onChange={(event) => setBusquedaOrdenes(event.target.value)} />
                      <select className="adm-input" value={ordenesFiltroEstado} onChange={(event) => setOrdenesFiltroEstado(event.target.value)}>
                        <option value="">Todos los estados</option>
                        <option value="pendiente_pago">Pendiente pago</option>
                        <option value="pagada">Pagada</option>
                        <option value="preparandose">Preparandose</option>
                        <option value="preparada">Preparada</option>
                        <option value="enviada">Enviada</option>
                        <option value="entregando">Entregando</option>
                        <option value="entregada">Entregada</option>
                        <option value="cancelada">Cancelada</option>
                        <option value="expirada">Expirada</option>
                      </select>
                      <select className="adm-input" value={ordenesFiltroEntrega} onChange={(event) => setOrdenesFiltroEntrega(event.target.value)}>
                        <option value="">Retiro y envio</option>
                        <option value="retiro">Solo retiro</option>
                        <option value="envio">Solo envio</option>
                      </select>
                      <button className="adm-btn-secondary" onClick={() => void expirarReservas()} disabled={busy}>
                        Expirar reservas vencidas
                      </button>
                    </div>
                    <p className="adm-inline-tip">
                      Pago y preparacion van separados: primero pagada, luego preparandose, preparada, enviada, entregando o entregada. Cancelada o expirada libera reservas pendientes y devuelve puntos si correspondia.
                    </p>
                  </div>

                  <div className="admin-card">
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Orden</th>
                            <th>Cliente</th>
                            <th>Canal</th>
                            <th>Tipo</th>
                            <th>Total</th>
                            <th>Entrega</th>
                            <th>Pago</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ordenesPagina.length === 0 ? (
                            <tr><td colSpan={9}><div className="adm-empty">No hay ventas para mostrar.</div></td></tr>
                          ) : null}
                          {ordenesPagina.map((orden) => (
                            <Fragment key={orden.id}>
                              <tr>
                                <td>
                                  #{orden.id}
                                  <br />
                                  <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{formatDate(orden.created_at)}</span>
                                </td>
                                <td>
                                  {orden.cliente_nombre}
                                  <br />
                                  <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{orden.cliente_email}</span>
                                </td>
                                <td>{formatCanalOrden(orden.canal)}</td>
                                <td>{orden.tipo_orden} ({orden.total_unidades} u.)</td>
                                <td>
                                  {formatMoney(orden.total_dinero)}
                                  {orden.total_puntos > 0 ? <><br /><span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>{orden.total_puntos} pts</span></> : null}
                                </td>
                                <td>
                                  {orden.direccion_envio ? "Envio" : "Retiro"}
                                  <br />
                                  <span style={{ color: "#8B5A30", fontSize: "0.75rem" }}>
                                    {orden.direccion_envio
                                      ? `${orden.direccion_envio.localidad || "-"} (${orden.direccion_envio.codigo_postal || "s/CP"})`
                                      : orden.sucursal_nombre || "-"}
                                  </span>
                                </td>
                                <td>{formatPagoOrden(orden)}</td>
                                <td>{formatEstadoOrden(orden.estado)}</td>
                                <td>
                                  <div className="adm-row-actions">
                                    <button className="adm-btn-link" onClick={() => setOrdenExpandidaId((prev) => prev === orden.id ? null : orden.id)}>
                                      {ordenExpandidaId === orden.id ? "Ocultar" : "Detalle"}
                                    </button>
                                    <Link className="adm-btn-link" to={`${panelBasePath}/pedidos/${orden.id}`} style={{ textDecoration: "none" }}>
                                      Ver comprobante
                                    </Link>
                                    {hasOrderMapPoint(orden.direccion_envio) ? (
                                      <button
                                        type="button"
                                        className="adm-btn-link"
                                        onClick={() => navigate(`${panelBasePath}/mapa-pedidos?pedido=${orden.id}`)}
                                      >
                                        Ver en mapa
                                      </button>
                                    ) : null}
                                    {orden.estado === "pendiente_pago" ? (
                                      <button className="adm-btn-success" onClick={() => void actualizarEstadoOrden(orden.id, "pagada")} disabled={busy}>Marcar pagada</button>
                                    ) : null}
                                    {orden.estado === "pagada" ? (
                                      <button className="adm-btn-success" onClick={() => void actualizarEstadoOrden(orden.id, "preparandose")} disabled={busy}>Preparar</button>
                                    ) : null}
                                    {orden.estado === "preparandose" ? (
                                      <button className="adm-btn-success" onClick={() => void actualizarEstadoOrden(orden.id, "preparada")} disabled={busy}>Pedido preparado</button>
                                    ) : null}
                                    {orden.estado === "preparada" && orden.direccion_envio ? (
                                      <button className="adm-btn-success" onClick={() => void actualizarEstadoOrden(orden.id, "enviada")} disabled={busy}>Enviar</button>
                                    ) : null}
                                    {orden.estado === "enviada" && orden.direccion_envio ? (
                                      <button className="adm-btn-success" onClick={() => void actualizarEstadoOrden(orden.id, "entregando")} disabled={busy}>Entregando</button>
                                    ) : null}
                                    {(!orden.direccion_envio && ["pagada", "preparandose", "preparada"].includes(orden.estado)) || orden.estado === "entregando" ? (
                                      <button className="adm-btn-success" onClick={() => void actualizarEstadoOrden(orden.id, "entregada")} disabled={busy}>Entregar</button>
                                    ) : null}
                                    {isOrdenVentaLocal(orden) && orden.estado !== "cancelada" && orden.estado !== "expirada"
                                      || (!isOrdenVentaLocal(orden) && (["pendiente_pago", "pagada", "preparandose", "preparada", "enviada", "entregando"] as OrdenAdmin["estado"][]).includes(orden.estado)) ? (
                                      <button
                                        className="adm-btn-danger"
                                        onClick={() => {
                                          if (isOrdenVentaLocal(orden)) {
                                            void cancelarVentaLocal(orden);
                                            return;
                                          }
                                          abrirCancelacionUrgente(orden);
                                        }}
                                        disabled={busy}
                                      >
                                        Cancelar
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                              {ordenExpandidaId === orden.id ? (
                                <tr>
                                  <td colSpan={9}>
                                    <div className="adm-inline-points-box">
                                      <p className="adm-inline-points-title">Detalle pedido #{orden.id}</p>
                                      <div className="adm-form-grid">
                                        <div>
                                          <p style={{ margin: "0 0 0.35rem", fontWeight: 800 }}>Productos</p>
                                          {(orden.items ?? []).map((item) => (
                                            <div key={`${orden.id}-${item.producto_id}-${item.modo_compra}-${item.nombre}`} style={{ margin: "0.15rem 0", color: "#4A2C1A" }}>
                                              <p style={{ margin: 0 }}>
                                                {item.nombre} x{item.cantidad} - {item.modo_compra === "dinero" ? formatMoney(item.subtotal_dinero) : `${item.subtotal_puntos} pts`}
                                              </p>
                                              {item.sabores?.length ? (
                                                <p style={{ margin: "0.1rem 0 0", color: "#8B5A30", fontSize: "0.85rem" }}>
                                                  {item.sabores.map((sabor) => `${sabor.nombre} x${sabor.cantidad}`).join(" | ")}
                                                </p>
                                              ) : null}
                                            </div>
                                          ))}
                                        </div>
                                        <div>
                                          <p style={{ margin: "0 0 0.35rem", fontWeight: 800 }}>{orden.direccion_envio ? "Datos de envio" : "Datos de retiro"}</p>
                                          {orden.direccion_envio ? (
                                            <>
                                              <p style={{ margin: "0.15rem 0" }}><strong>Recibe:</strong> {orden.direccion_envio.nombre || "-"}</p>
                                              <p style={{ margin: "0.15rem 0" }}><strong>Telefono:</strong> {orden.direccion_envio.telefono || "-"}</p>
                                              <p style={{ margin: "0.15rem 0" }}><strong>Direccion:</strong> {orden.direccion_envio.direccion || "-"}</p>
                                              <p style={{ margin: "0.15rem 0" }}><strong>CP:</strong> {orden.direccion_envio.codigo_postal || "-"} - {orden.direccion_envio.localidad || "-"}, {orden.direccion_envio.provincia || "-"}</p>
                                              {orden.direccion_envio.referencias ? <p style={{ margin: "0.15rem 0" }}><strong>Referencias:</strong> {orden.direccion_envio.referencias}</p> : null}
                                              <p style={{ margin: "0.15rem 0", color: "#8B5A30" }}>Sucursal que prepara: {orden.sucursal_nombre || "-"}</p>
                                            </>
                                          ) : (
                                            <p style={{ margin: "0.15rem 0" }}>
                                              {orden.sucursal?.nombre || orden.sucursal_nombre || "-"}
                                              {orden.sucursal?.direccion ? ` - ${orden.sucursal.direccion}` : ""}
                                              {orden.sucursal?.piso ? `, Piso ${orden.sucursal.piso}` : ""}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      {orden.notas ? <p style={{ margin: "0.65rem 0 0", color: "#8B5A30" }}><strong>Notas:</strong> {orden.notas}</p> : null}
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
                      page={ordenesPage}
                      totalPages={totalOrdenesPages}
                      onPrev={() => setOrdenesPage((prev) => Math.max(1, prev - 1))}
                      onNext={() => setOrdenesPage((prev) => Math.min(totalOrdenesPages, prev + 1))}
                    />
                  </div>
                </>
              }
              reportesContent={
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.85rem" }}>
                    <h3 style={{ margin: 0, color: "#3D1A02" }}>Exportar ventas</h3>
                    <div className="adm-form-grid">
                      <select className="adm-input" value={ventasExportCanal} onChange={(event) => setVentasExportCanal(event.target.value)}>
                        <option value="">Web + locales</option>
                        <option value="web">Solo web</option>
                        <option value="admin">Solo local admin</option>
                        <option value="vendedor">Solo local vendedor</option>
                      </select>
                      <input className="adm-input" type="date" value={ventasExportDesde} onChange={(event) => setVentasExportDesde(event.target.value)} />
                      <input className="adm-input" type="date" value={ventasExportHasta} onChange={(event) => setVentasExportHasta(event.target.value)} />
                      <button type="button" className="adm-btn-secondary" onClick={() => void descargarVentas("pdf")} disabled={busy}>
                        Descargar PDF
                      </button>
                      <button type="button" className="adm-btn-secondary" onClick={() => void descargarVentas("xlsx")} disabled={busy}>
                        Excel
                      </button>
                    </div>
                    <p className="adm-inline-tip" style={{ margin: 0 }}>
                      El PDF se genera como archivo real para descargar. Todas las fechas salen en horario de Buenos Aires.
                    </p>
                  </div>
                </div>
              }
            />
          ) : null}

          {tab === "caja" ? (
            <div style={{ display: "grid", gap: "1.5rem" }}>
              <SectionTitle title="Caja diaria" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.8rem" }}>
                <h3 style={{ margin: 0, color: "#3D1A02" }}>Reporte PDF de caja</h3>
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Elegi una sucursal y un dia para exportar la caja completa: resumen, ventas, gastos y movimientos.
                </p>
                <div className="adm-form-grid">
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Dia de caja" tip="Fecha operativa en horario Buenos Aires. El PDF toma la caja de esa sucursal y ese dia." />
                    <input
                      className="adm-input"
                      type="date"
                      value={cajaReporteFecha}
                      onChange={(event) => setCajaReporteFecha(event.target.value)}
                    />
                  </label>
                  <button type="button" className="adm-btn-secondary" disabled={busy || !cajaSucursalId || !cajaReporteFecha} onClick={() => void descargarCajaPdf()}>
                    Exportar caja en PDF
                  </button>
                </div>
              </div>
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.9rem" }}>
                <div className="adm-form-grid">
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Sucursal" tip="Sucursal que queres revisar. La caja diaria y el historial cambian segun este punto de venta." />
                    <select className="adm-input" value={cajaSucursalId} onChange={(event) => setCajaSucursalId(event.target.value)}>
                      <option value="">Sucursal</option>
                      {sucursales.filter((sucursal) => sucursal.activo).map((sucursal) => (
                        <option key={sucursal.id} value={sucursal.id}>{sucursal.nombre}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="admin-card" style={{ padding: "0.9rem", display: "grid", gap: "0.75rem" }}>
                  <div>
                    <strong>Apertura / efectivo inicial</strong>
                    <p className="adm-inline-tip" style={{ margin: "0.25rem 0 0" }}>
                      Es la plata en efectivo con la que arranca la caja del dia. Se suma solo al calculo de efectivo: apertura + ventas en efectivo - gastos en efectivo.
                    </p>
                  </div>
                  <div className="adm-form-grid">
                    <label style={{ display: "grid", gap: "0.35rem" }}>
                      <FieldLabel text="Monto inicial" tip="Carga el efectivo fisico que habia en la caja al empezar el dia. Si no habia efectivo, dejalo vacio." />
                      <input
                        className="adm-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={cajaMontoApertura}
                        onChange={(event) => setCajaMontoApertura(event.target.value)}
                      />
                    </label>
                    <label style={{ display: "grid", gap: "0.35rem" }}>
                      <FieldLabel text="Nota de apertura" tip="Opcional. Sirve para dejar registro de quien conto la caja o alguna aclaracion." />
                      <input
                        className="adm-input"
                        value={cajaObservacionesApertura}
                        onChange={(event) => setCajaObservacionesApertura(event.target.value)}
                        placeholder="Ej: fondo fijo contado al iniciar el dia"
                      />
                    </label>
                    <button type="button" className="adm-btn-secondary" disabled={busy || !cajaSucursalId} onClick={() => void abrirCaja()}>
                      Guardar apertura
                    </button>
                  </div>
                </div>
                {cajaActual ? (
                  <div className="admin-card" style={{ padding: "0.9rem", display: "grid", gap: "0.75rem" }}>
                    <div>
                      <strong>Cierre de caja</strong>
                      <p className="adm-inline-tip" style={{ margin: "0.25rem 0 0" }}>
                        Cuando termine la jornada, registra cuanto efectivo habia realmente en caja para comparar contra el calculo del sistema.
                      </p>
                    </div>
                    <div className="adm-form-grid">
                      <label style={{ display: "grid", gap: "0.35rem" }}>
                        <FieldLabel text="Monto contado al cierre" tip="Importe real contado en efectivo al cerrar la caja." />
                        <input
                          className="adm-input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={cajaMontoCierre}
                          onChange={(event) => setCajaMontoCierre(event.target.value)}
                        />
                      </label>
                      <label style={{ display: "grid", gap: "0.35rem" }}>
                        <FieldLabel text="Nota de cierre" tip="Observacion opcional para explicar diferencias o dejar un detalle de arqueo." />
                        <input
                          className="adm-input"
                          value={cajaObservacionesCierre}
                          onChange={(event) => setCajaObservacionesCierre(event.target.value)}
                          placeholder="Ej: diferencia detectada al arqueo"
                        />
                      </label>
                      <button type="button" className="adm-btn-primary" disabled={busy || !cajaActual?.id} onClick={() => void cerrarCaja()}>
                        Guardar cierre
                      </button>
                    </div>
                  </div>
                ) : null}
                {cajaActual ? (
                  <>
                    <div className="adm-form-grid">
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Sucursal</strong>
                        <p style={{ margin: "0.25rem 0 0" }}>{cajaActual.sucursal_nombre}</p>
                      </div>
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Fecha operativa</strong>
                        <p style={{ margin: "0.25rem 0 0" }}>{cajaActual.fecha_operativa}</p>
                      </div>
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Apertura</strong>
                        <p style={{ margin: "0.25rem 0 0" }}>{formatMoney(cajaActual.monto_apertura)}</p>
                      </div>
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Ventas</strong>
                        <p style={{ margin: "0.25rem 0 0" }}>{formatMoney(cajaActual.summary.totalVentas)}</p>
                      </div>
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Gastos</strong>
                        <p style={{ margin: "0.25rem 0 0" }}>{formatMoney(cajaActual.summary.totalGastos)}</p>
                      </div>
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Efectivo del dia</strong>
                        <p style={{ margin: "0.25rem 0 0" }}>{formatMoney(cajaActual.summary.efectivoSistema)}</p>
                      </div>
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Movimientos</strong>
                        <p style={{ margin: "0.25rem 0 0" }}>{cajaActual.summary.cantidadMovimientos}</p>
                      </div>
                    </div>
                    <p className="adm-inline-tip" style={{ margin: 0 }}>
                      La caja se abre automaticamente a las 00:00 y cierra al terminar el dia en horario Buenos Aires. Todas las ventas locales y gastos de esta sucursal se acumulan en este resumen diario.
                    </p>
                    <div className="adm-form-grid">
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Ventas por medio</strong>
                        {Object.entries(cajaActual.summary.ventasPorMedio).map(([medio, monto]) => (
                          <p key={`venta-${medio}`} style={{ margin: "0.2rem 0 0", color: "#8B5A30" }}>
                            {formatMetodoPago(medio)}: {formatMoney(monto)}
                          </p>
                        ))}
                      </div>
                      <div className="admin-card" style={{ padding: "0.9rem" }}>
                        <strong>Gastos por medio</strong>
                        {Object.entries(cajaActual.summary.gastosPorMedio).map(([medio, monto]) => (
                          <p key={`gasto-${medio}`} style={{ margin: "0.2rem 0 0", color: "#8B5A30" }}>
                            {formatMetodoPago(medio)}: {formatMoney(monto)}
                          </p>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="adm-inline-tip" style={{ margin: 0 }}>
                    No se pudo generar la caja diaria para esta sucursal.
                  </p>
                )}
              </div>

              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.8rem" }}>
                <h3 style={{ margin: 0, color: "#3D1A02" }}>Historial de cajas</h3>
                {cajaSesiones.length === 0 ? (
                  <div className="adm-empty">Todavia no hay cajas registradas.</div>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Sucursal</th>
                          <th>Estado</th>
                          <th>Apertura</th>
                          <th>Ventas</th>
                          <th>Gastos</th>
                          <th>Efectivo sistema</th>
                          <th>Diferencia</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cajaSesiones.map((sesion) => (
                          <tr key={sesion.id}>
                            <td>{sesion.fecha_operativa}</td>
                            <td>{sesion.sucursal_nombre}</td>
                            <td>{sesion.estado === "abierta" ? "Abierta" : "Cerrada"}</td>
                            <td>{formatMoney(sesion.monto_apertura)}</td>
                            <td>{formatMoney(sesion.summary.totalVentas)}</td>
                            <td>{formatMoney(sesion.summary.totalGastos)}</td>
                            <td>{formatMoney(sesion.summary.efectivoSistema)}</td>
                            <td>{sesion.diferencia_cierre === null ? "-" : formatMoney(sesion.diferencia_cierre)}</td>
                            <td>
                              <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
                                <button className="adm-btn-link" onClick={() => iniciarEdicionCaja(sesion)} disabled={busy}>
                                  Editar
                                </button>
                                <button className="adm-btn-link" onClick={() => void descargarCajaPdf(sesion.fecha_operativa, String(sesion.sucursal_id))} disabled={busy}>
                                  Exportar
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <PaginationControls
                  page={cajaSesionesPage}
                  totalPages={cajaSesionesTotalPages}
                  onPrev={() => setCajaSesionesPage((prev) => Math.max(1, prev - 1))}
                  onNext={() => setCajaSesionesPage((prev) => Math.min(cajaSesionesTotalPages, prev + 1))}
                />
              </div>
            </div>
          ) : null}

          {tab === "gastos" ? (
            <div style={{ display: "grid", gap: "1.5rem" }}>
              <SectionTitle title="Gastos" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.9rem" }}>
                <h3 style={{ margin: 0, color: "#3D1A02" }}>Registrar gasto</h3>
                <div className="adm-form-grid">
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Proveedor" tip="Elegilo si el gasto fue para un proveedor ya cargado. Si no existe en la lista, usa el campo de persona o comercio manual." />
                    <select className="adm-input" value={gastoProveedorId} onChange={(event) => setGastoProveedorId(event.target.value)}>
                      <option value="">Proveedor</option>
                      {proveedores.filter((proveedor) => proveedor.activo !== false).map((proveedor) => (
                        <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Persona o comercio manual" tip="Usa este campo cuando el gasto fue para alguien que no esta cargado en Proveedores. Ejemplo: un fletero, tecnico o compra puntual." />
                    <input className="adm-input" placeholder="Persona o comercio (si no esta en proveedores)" value={gastoTerceroNombre} onChange={(event) => setGastoTerceroNombre(event.target.value)} disabled={Boolean(gastoProveedorId)} />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Categoria" tip="Sirve para ordenar el gasto despues en reportes. Ejemplos: insumos, envio, mantenimiento, servicios." />
                    <input className="adm-input" placeholder="Categoria" value={gastoCategoria} onChange={(event) => setGastoCategoria(event.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Descripcion" tip="Detalle corto para entender rapido que se pago." />
                    <input className="adm-input" placeholder="Descripcion" value={gastoDescripcion} onChange={(event) => setGastoDescripcion(event.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Medio de pago" tip="Forma en la que se pagó el gasto. Esto impacta en el resumen de caja del dia." />
                    <select className="adm-input" value={gastoMedioPago} onChange={(event) => setGastoMedioPago(event.target.value)}>
                      <option value="cash">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="tarjeta">Tarjeta</option>
                      <option value="qr">QR</option>
                      <option value="otro">Otro</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Monto" tip="Importe real del gasto. Se descuenta del resumen diario segun el medio de pago elegido." />
                    <input className="adm-input" type="number" min={0} step="0.01" placeholder="Monto" value={gastoMonto} onChange={(event) => setGastoMonto(event.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Notas" tip="Dato interno opcional para dejar aclaraciones del gasto." />
                    <input className="adm-input" placeholder="Notas" value={gastoNotas} onChange={(event) => setGastoNotas(event.target.value)} />
                  </label>
                  <button type="button" className="adm-btn-secondary" disabled={busy || !cajaActual} onClick={() => void registrarGasto()}>
                    Guardar gasto
                  </button>
                </div>
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Los gastos quedan atados automaticamente a la caja diaria de la sucursal elegida.
                </p>
              </div>

              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.8rem" }}>
                <h3 style={{ margin: 0, color: "#3D1A02" }}>Ultimos gastos</h3>
                {gastos.length === 0 ? (
                  <div className="adm-empty">Todavia no hay gastos cargados.</div>
                ) : (
                  gastos.slice(0, 12).map((gasto) => {
                    const editing = gastoEditId === gasto.id;
                    return (
                      <div key={gasto.id} style={{ borderBottom: "1px solid rgba(180,84,20,0.14)", paddingBottom: "0.75rem", display: "grid", gap: "0.55rem" }}>
                        {editing ? (
                          <>
                            <div className="adm-form-grid">
                              <select
                                className="adm-input"
                                value={gastoEditDraft.proveedor_id}
                                onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, proveedor_id: event.target.value, tercero_nombre: event.target.value ? "" : prev.tercero_nombre }))}
                              >
                                <option value="">Proveedor</option>
                                {proveedores.filter((proveedor) => proveedor.activo !== false).map((proveedor) => (
                                  <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>
                                ))}
                              </select>
                              <input
                                className="adm-input"
                                placeholder="Persona o comercio"
                                value={gastoEditDraft.tercero_nombre}
                                disabled={Boolean(gastoEditDraft.proveedor_id)}
                                onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, tercero_nombre: event.target.value }))}
                              />
                              <input
                                className="adm-input"
                                placeholder="Categoria"
                                value={gastoEditDraft.categoria}
                                onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, categoria: event.target.value }))}
                              />
                              <input
                                className="adm-input"
                                placeholder="Descripcion"
                                value={gastoEditDraft.descripcion}
                                onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, descripcion: event.target.value }))}
                              />
                              <select
                                className="adm-input"
                                value={gastoEditDraft.medio_pago}
                                onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, medio_pago: event.target.value }))}
                              >
                                <option value="cash">Efectivo</option>
                                <option value="transferencia">Transferencia</option>
                                <option value="tarjeta">Tarjeta</option>
                                <option value="qr">QR</option>
                                <option value="otro">Otro</option>
                              </select>
                              <input
                                className="adm-input"
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="Monto"
                                value={gastoEditDraft.monto}
                                onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, monto: event.target.value }))}
                              />
                              <input
                                className="adm-input"
                                placeholder="Notas"
                                value={gastoEditDraft.notas}
                                onChange={(event) => setGastoEditDraft((prev) => ({ ...prev, notas: event.target.value }))}
                              />
                            </div>
                            <div className="adm-row-actions">
                              <button className="adm-btn-success" disabled={busy} onClick={() => void guardarGastoEditado()}>Guardar</button>
                              <button className="adm-btn-link" disabled={busy} onClick={() => setGastoEditId(null)}>Cancelar</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <strong>{gasto.descripcion}</strong>
                              <p style={{ margin: "0.2rem 0 0", color: "#8B5A30" }}>
                                {gasto.categoria} / {formatMoney(gasto.monto)} / {formatMetodoPago(gasto.medio_pago)} / {gasto.proveedor_nombre || gasto.tercero_nombre || "Sin nombre"}
                              </p>
                              {gasto.notas ? (
                                <p style={{ margin: "0.15rem 0 0", color: "#8B5A30", fontSize: "0.82rem" }}>{gasto.notas}</p>
                              ) : null}
                            </div>
                            <div className="adm-row-actions">
                              <button className="adm-btn-link" disabled={busy} onClick={() => empezarEditarGasto(gasto)}>Editar</button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          {tab === "proveedores" ? (
            <div style={{ display: "grid", gap: "1.5rem" }}>
              <SectionTitle title="Proveedores" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.8rem" }}>
                <h3 style={{ margin: 0, color: "#3D1A02" }}>Nuevo proveedor</h3>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <FieldLabel text="Nombre proveedor" tip="Nombre principal con el que vas a identificar a este proveedor en compras y gastos." />
                  <input className="adm-input" placeholder="Nombre proveedor" value={nuevoProveedor.nombre} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, nombre: event.target.value }))} />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <FieldLabel text="Contacto" tip="Persona de referencia dentro del proveedor. Puede ser quien vende o atiende." />
                  <input className="adm-input" placeholder="Contacto" value={nuevoProveedor.contacto} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, contacto: event.target.value }))} />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <FieldLabel text="Telefono" tip="Telefono del proveedor o del contacto principal." />
                  <input className="adm-input" placeholder="Telefono" value={nuevoProveedor.telefono} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, telefono: event.target.value }))} />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <FieldLabel text="Email" tip="Correo para pedidos, consultas o seguimiento del proveedor." />
                  <input className="adm-input" placeholder="Email" value={nuevoProveedor.email} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, email: event.target.value }))} />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <FieldLabel text="Notas" tip="Aclaraciones internas utiles para el equipo: horarios, condiciones, observaciones, etc." />
                  <input className="adm-input" placeholder="Notas" value={nuevoProveedor.notas} onChange={(event) => setNuevoProveedor((prev) => ({ ...prev, notas: event.target.value }))} />
                </label>
                <button type="button" className="adm-btn-secondary" disabled={busy} onClick={() => void crearProveedor()}>
                  Crear proveedor
                </button>
              </div>

              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.8rem" }}>
                <h3 style={{ margin: 0, color: "#3D1A02" }}>Listado de proveedores</h3>
                {proveedores.length === 0 ? (
                  <div className="adm-empty">Todavia no hay proveedores cargados.</div>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Contacto</th>
                          <th>Telefono</th>
                          <th>Email</th>
                          <th>Notas</th>
                          <th>Activo</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proveedores.map((proveedor) => {
                          const editing = proveedorEditId === proveedor.id;
                          return (
                            <tr key={proveedor.id}>
                              <td>
                                {editing ? (
                                  <input
                                    className="adm-input"
                                    value={proveedorEditDraft.nombre}
                                    onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, nombre: event.target.value }))}
                                  />
                                ) : proveedor.nombre}
                              </td>
                              <td>
                                {editing ? (
                                  <input
                                    className="adm-input"
                                    value={proveedorEditDraft.contacto}
                                    onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, contacto: event.target.value }))}
                                  />
                                ) : proveedor.contacto || "-"}
                              </td>
                              <td>
                                {editing ? (
                                  <input
                                    className="adm-input"
                                    value={proveedorEditDraft.telefono}
                                    onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, telefono: event.target.value }))}
                                  />
                                ) : proveedor.telefono || "-"}
                              </td>
                              <td>
                                {editing ? (
                                  <input
                                    className="adm-input"
                                    value={proveedorEditDraft.email}
                                    onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, email: event.target.value }))}
                                  />
                                ) : proveedor.email || "-"}
                              </td>
                              <td>
                                {editing ? (
                                  <input
                                    className="adm-input"
                                    value={proveedorEditDraft.notas}
                                    onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, notas: event.target.value }))}
                                  />
                                ) : proveedor.notas || "-"}
                              </td>
                              <td>
                                {editing ? (
                                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 700 }}>
                                    <input
                                      type="checkbox"
                                      checked={proveedorEditDraft.activo}
                                      onChange={(event) => setProveedorEditDraft((prev) => ({ ...prev, activo: event.target.checked }))}
                                    />
                                    {proveedorEditDraft.activo ? "Si" : "No"}
                                  </label>
                                ) : proveedor.activo === false ? "No" : "Si"}
                              </td>
                              <td>
                                {editing ? (
                                  <div className="adm-row-actions">
                                    <button className="adm-btn-success" onClick={() => void guardarProveedorEditado()} disabled={busy}>Guardar</button>
                                    <button className="adm-btn-link" onClick={() => setProveedorEditId(null)} disabled={busy}>Cancelar</button>
                                  </div>
                                ) : (
                                  <button className="adm-btn-link" onClick={() => empezarEditarProveedor(proveedor)} disabled={busy}>Editar</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "cobros" ? (
            <div style={{ display: "grid", gap: "1.5rem" }}>
              <SectionTitle title="Costos de cobro" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.85rem" }}>
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Carga aca el porcentaje que te descuenta cada medio. En los reportes se mostrara bruto, comision y neto real. Efectivo normalmente va en 0%.
                </p>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th><FieldLabel text="Proveedor" tip="Empresa o fuente del cobro. Ejemplo: Mercado Pago, efectivo o venta local." /></th>
                        <th><FieldLabel text="Medio" tip="Forma concreta con la que entra el dinero: efectivo, QR, tarjeta, wallet, transferencia, etc." /></th>
                        <th><FieldLabel text="Descripcion" tip="Nombre interno de la regla para que el equipo entienda rapido a que cobro corresponde." /></th>
                        <th><FieldLabel text="% Comision" tip="Porcentaje que queres descontar del bruto para calcular el neto real en reportes." /></th>
                        <th><FieldLabel text="Activo" tip="Si esta apagado, esa regla no descuenta nada aunque exista cargada." /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {costosCobro.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="adm-empty">No hay reglas de costos de cobro para editar.</div>
                          </td>
                        </tr>
                      ) : null}
                      {costosCobro.map((item) => {
                        const key = paymentFeeDraftKey(item.proveedor, item.metodo);
                        const draft = costosCobroDraft[key] ?? {
                          descripcion: item.descripcion,
                          porcentaje: emptyZeroInputValue(item.porcentaje),
                          activo: Boolean(item.activo),
                        };
                        return (
                          <tr key={`costo-cobro-${item.id}`}>
                            <td>{formatProveedorPago(item.proveedor)}</td>
                            <td>{formatMetodoPago(item.metodo)}</td>
                            <td>
                              <input
                                className="adm-input"
                                value={draft.descripcion}
                                onChange={(event) => updateCostoCobroDraft(item.proveedor, item.metodo, { descripcion: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                className="adm-input"
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={draft.porcentaje}
                                onChange={(event) => updateCostoCobroDraft(item.proveedor, item.metodo, { porcentaje: normalizeDiscountDraftValue(event.target.value) })}
                              />
                            </td>
                            <td>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontWeight: 700, color: "#6C3B15" }}>
                                <input
                                  type="checkbox"
                                  checked={draft.activo}
                                  onChange={(event) => updateCostoCobroDraft(item.proveedor, item.metodo, { activo: event.target.checked })}
                                />
                                {draft.activo ? "Si" : "No"}
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="adm-btn-primary" disabled={busy || costosCobro.length === 0} onClick={() => void guardarCostosCobro()}>
                  {busy ? "Guardando..." : "Guardar costos de cobro"}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "descuentos" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Descuentos" />
              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.9rem" }}>
                <FieldLabel text="Descuentos por categoria" tip="Aca defines descuentos normales por perfil y categoria. Ejemplo: empleado 50% en alfajores, mayorista 20% en cajas." />
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Define el descuento fijo por tipo de cliente y categoria. Esto aplica tanto en web como en venta local. Si dejas 0%, esa categoria queda sin descuento para ese perfil.
                </p>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th><FieldLabel text="Categoria" tip="Linea de producto a la que se aplica el descuento: alfajores, cajas, confites, etc." /></th>
                        <th><FieldLabel text="Cliente" tip="Descuento para clientes web normales o comunes." /></th>
                        <th><FieldLabel text="Mayorista" tip="Descuento para usuarios marcados como mayoristas." /></th>
                        <th><FieldLabel text="Empleado" tip="Descuento para usuarios marcados como empleados o vendedores con beneficio interno." /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoriasActivas.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <div className="adm-empty">Primero crea o activa categorias para poder asignar descuentos.</div>
                          </td>
                        </tr>
                      ) : null}
                      {categoriasActivas.map((categoria) => (
                        <tr key={`discount-${categoria.id}`}>
                          <td>{categoria.nombre}</td>
                          {DISCOUNT_CLIENT_TYPES.map((tipoCliente) => (
                            <td key={`${categoria.id}-${tipoCliente}`}>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                className="adm-input"
                                value={descuentosCategoriasDraft[discountDraftKey(tipoCliente, categoria.nombre)] ?? ""}
                                onChange={(event) => updateDescuentoCategoriaDraft(tipoCliente, categoria.nombre, event.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="adm-btn-primary" disabled={busy || categoriasActivas.length === 0} onClick={guardarDescuentosCategorias}>
                  {busy ? "Guardando..." : "Guardar descuentos por categoria"}
                </button>
              </div>

              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.9rem" }}>
                <FieldLabel text="Descuentos por producto" tip="Aplica un descuento puntual a un producto especifico. Si tambien existe descuento por categoria, el sistema usa el mayor." />
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Usalo para promos unitarias sin afectar toda la categoria. Vacio o 0% deja ese producto sin descuento especial para ese perfil.
                </p>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th><FieldLabel text="Producto" tip="Producto de venta online o mixto con precio en dinero." /></th>
                        <th>Categoria</th>
                        <th><FieldLabel text="Cliente" tip="Descuento puntual para clientes comunes." /></th>
                        <th><FieldLabel text="Mayorista" tip="Descuento puntual para mayoristas." /></th>
                        <th><FieldLabel text="Empleado" tip="Descuento puntual para empleados." /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {productosDescuentoUnitario.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="adm-empty">No hay productos activos con precio de venta para asignar descuentos unitarios.</div>
                          </td>
                        </tr>
                      ) : null}
                      {productosDescuentoUnitario.map((producto) => (
                        <tr key={`product-discount-${producto.id}`}>
                          <td><strong>{producto.nombre}</strong></td>
                          <td>{producto.categoria || "Sin categoria"}</td>
                          {DISCOUNT_CLIENT_TYPES.map((tipoCliente) => (
                            <td key={`${producto.id}-${tipoCliente}`}>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                className="adm-input"
                                value={descuentosProductosDraft[productDiscountDraftKey(tipoCliente, Number(producto.id))] ?? ""}
                                onChange={(event) => updateDescuentoProductoDraft(tipoCliente, Number(producto.id), event.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="adm-btn-primary" disabled={busy || productosDescuentoUnitario.length === 0} onClick={guardarDescuentosProductos}>
                  {busy ? "Guardando..." : "Guardar descuentos por producto"}
                </button>
              </div>

              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.9rem" }}>
                <FieldLabel text="Campana Web Global" tip="Esto es para promociones generales web como Hot Sale o Black Friday. No reemplaza los descuentos por categoria: se usa para campañas temporales." />
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Usa esta campana para Hot Sale, Black Friday o promos generales de la tienda online. Solo afecta compras web y no se aplica a ventas locales.
                </p>
                <p className="adm-inline-tip" style={{ margin: 0 }}>
                  Se activa automaticamente al guardar si algun perfil tiene descuento mayor a 0. Si dejas todos vacios o en 0, se desactiva.
                </p>
                <div className="adm-form-grid">
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Tipo de cliente" tip="Escribi Cliente, Mayorista o Empleado y elegi de la lista." />
                    <input
                      list="web-discount-profile-options"
                      className="adm-input"
                      value={webDiscountProfileSearch}
                      onChange={(event) => {
                        const value = event.target.value;
                        setWebDiscountProfileSearch(value);
                        const matchedType = tipoClienteFromLabel(value);
                        if (matchedType) {
                          setWebDiscountSelectedType(matchedType);
                        }
                      }}
                      placeholder="Cliente, Mayorista o Empleado"
                    />
                    <datalist id="web-discount-profile-options">
                      {DISCOUNT_CLIENT_TYPES.map((tipoCliente) => (
                        <option key={tipoCliente} value={formatTipoClienteLabel(tipoCliente)} />
                      ))}
                    </datalist>
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel
                      text={`Descuento ${formatTipoClienteLabel(webDiscountSelectedType)}`}
                      tip="Porcentaje temporal que se aplicara en tienda online para el perfil seleccionado."
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className="adm-input"
                      value={webDiscountDraft[webDiscountSelectedType]}
                      onChange={(event) => {
                        const value = normalizeDiscountDraftValue(event.target.value);
                        setWebDiscountDraft((prev) => ({ ...prev, [webDiscountSelectedType]: value }));
                      }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
                  {DISCOUNT_CLIENT_TYPES.map((tipoCliente) => (
                    <span
                      key={`web-discount-summary-${tipoCliente}`}
                      className="adm-inline-tip"
                      style={{ margin: 0, padding: "0.45rem 0.7rem" }}
                    >
                      {formatTipoClienteLabel(tipoCliente)}: {webDiscountDraft[tipoCliente] || "0"}%
                    </span>
                  ))}
                </div>
                <button className="adm-btn-primary" disabled={busy} onClick={guardarCampaniaWeb}>
                  {busy ? "Guardando..." : "Guardar campana web"}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "categorias" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SectionTitle title="Nueva categoria" />
              <div className="admin-card admin-card-padded adm-category-guide">
                <div className="adm-category-guide-head">
                  <div>
                    <p className="adm-category-guide-eyebrow">Guia para imagenes IA</p>
                    <h3 className="adm-category-guide-title">Como preparar iconos para que se vean como las categorias de marca del Home</h3>
                  </div>
                  <div className="adm-category-guide-badge">Home</div>
                </div>

                <div className="adm-category-guide-grid">
                  {CATEGORY_IMAGE_GUIDE_ITEMS.map((item) => (
                    <div key={item.label} className="adm-category-guide-item">
                      <p className="adm-category-guide-item-label">{item.label}</p>
                      <p className="adm-category-guide-item-text">{item.text}</p>
                    </div>
                  ))}
                </div>

                <div className="adm-category-guide-prompt-box">
                  <p className="adm-category-guide-item-label">Prompt base para categorias nuevas</p>
                  <p className="adm-category-guide-code">{CATEGORY_IMAGE_PROMPT_TEMPLATE}</p>
                </div>

                <div className="adm-category-guide-prompts">
                  {CATEGORY_IMAGE_PROMPTS.map((item) => (
                    <div key={item.nombre} className="adm-category-guide-prompt-card">
                      <p className="adm-category-guide-item-label">{item.nombre}</p>
                      <p className="adm-category-guide-code">{item.prompt}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="admin-card admin-card-padded" style={{ display: "grid", gap: "0.9rem" }}>
                <div className="adm-form-grid">
                  <div className="adm-field">
                    <label className="adm-label">Nombre</label>
                    <input className="adm-input" placeholder="Ej: Alfajores" value={nuevaCategoria.nombre} onChange={(event) => setNuevaCategoria((prev) => ({ ...prev, nombre: event.target.value }))} />
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Orden (Home)</label>
                    <input className="adm-input" type="number" value={nuevaCategoria.orden} onChange={(event) => setNuevaCategoria((prev) => ({ ...prev, orden: Number(event.target.value) }))} />
                  </div>
                  <div className="adm-field">
                    <label className="adm-label">Imagen / icono para Home</label>
                    <label className="adm-upload-zone">
                      <input type="file" accept="image/jpeg, image/png, image/webp" onChange={(e) => { if (e.target.files?.[0]) void subirImagenCategoria(e.target.files[0], "nuevo"); }} />
                      <span className="adm-upload-btn">Elegir imagen</span>
                      {nuevaCategoria.imagen_url && <img src={nuevaCategoria.imagen_url} alt="Preview" style={{ height: "40px", borderRadius: "4px" }} />}
                    </label>
                    <p className="adm-field-help">Ideal: PNG o WebP cuadrado, fondo transparente y un solo icono centrado.</p>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#4A2C1A", fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={nuevaCategoria.activo}
                      onChange={(event) => setNuevaCategoria((prev) => ({ ...prev, activo: event.target.checked }))}
                    />
                    Activa
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#4A2C1A", fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={nuevaCategoria.mostrar_en_home}
                      onChange={(event) => setNuevaCategoria((prev) => ({ ...prev, mostrar_en_home: event.target.checked }))}
                    />
                    Mostrar en Home
                  </label>
                </div>
                <div className="adm-field">
                  <label className="adm-label">Descripcion</label>
                  <textarea
                    className="adm-input"
                    rows={2}
                    placeholder="Detalle interno opcional"
                    value={nuevaCategoria.descripcion}
                    onChange={(event) => setNuevaCategoria((prev) => ({ ...prev, descripcion: event.target.value }))}
                  />
                </div>
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
                        <th>Categoría</th>
                        <th>Matriz</th>
                        <th>Estado</th>
                        <th>Creada</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoriasPagina.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="adm-empty">No hay categorias para mostrar.</div>
                          </td>
                        </tr>
                      ) : null}
                      {categoriasPagina.map((categoria) => (
                        <Fragment key={categoria.id}>
                          <tr>
                            <td>
                              <strong>{categoria.nombre}</strong>
                              <div style={{ fontSize: "0.85em", color: "#666" }}>{categoria.descripcion || "-"}</div>
                            </td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                {categoria.imagen_url && <img src={categoria.imagen_url} alt="" style={{ height: "30px", borderRadius: "4px" }} />}
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                  <span style={{ fontSize: "0.85em" }}>Orden: {categoria.orden ?? 0}</span>
                                  {categoria.mostrar_en_home ? <span className="adm-badge adm-badge-active" style={{ padding: "0.1rem 0.3rem", fontSize: "0.7em" }}>En Home</span> : null}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className={`adm-badge ${categoria.activo !== false ? "adm-badge-active" : "adm-badge-inactive"}`}>
                                {categoria.activo !== false ? "Activa" : "Inactiva"}
                              </span>
                            </td>
                            <td>{formatDate(categoria.created_at)}</td>
                            <td>
                              <div className="adm-user-actions">
                                <button className="adm-btn-link" onClick={() => empezarEditarCategoria(categoria)} disabled={busy}>
                                  Editar
                                </button>
                                <button
                                  className={categoria.activo !== false ? "adm-btn-danger" : "adm-btn-success"}
                                  onClick={() => void toggleCategoriaActiva(categoria)}
                                  disabled={busy}
                                >
                                  {categoria.activo !== false ? "Desactivar" : "Activar"}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {categoriaEditId === categoria.id ? (
                            <tr>
                              <td colSpan={5}>
                                <div className="adm-inline-points-box">
                                  <p className="adm-inline-points-title">Editar categoria: {categoria.nombre}</p>
                                  <div className="adm-form-grid" style={{ marginBottom: "0.6rem" }}>
                                    <input
                                      className="adm-input"
                                      placeholder="Nombre"
                                      value={categoriaEditDraft.nombre}
                                      onChange={(event) => setCategoriaEditDraft((prev) => ({ ...prev, nombre: event.target.value }))}
                                    />
                                    <input
                                      className="adm-input"
                                      type="number"
                                      placeholder="Orden"
                                      value={categoriaEditDraft.orden}
                                      onChange={(event) => setCategoriaEditDraft((prev) => ({ ...prev, orden: Number(event.target.value) }))}
                                    />
                                    <label className="adm-upload-zone" style={{ margin: 0, padding: "0.4rem", minHeight: "44px" }}>
                                      <input type="file" accept="image/jpeg, image/png, image/webp" onChange={(e) => { if (e.target.files?.[0]) void subirImagenCategoria(e.target.files[0], "edit"); }} />
                                      <span className="adm-upload-btn" style={{ padding: "0.2rem 0.5rem" }}>Elegir imagen</span>
                                      {categoriaEditDraft.imagen_url && <img src={categoriaEditDraft.imagen_url} alt="Preview" style={{ height: "30px", borderRadius: "4px" }} />}
                                    </label>
                                    <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#4A2C1A", fontWeight: 700 }}>
                                      <input
                                        type="checkbox"
                                        checked={categoriaEditDraft.activo}
                                        onChange={(event) => setCategoriaEditDraft((prev) => ({ ...prev, activo: event.target.checked }))}
                                      />
                                      Activa
                                    </label>
                                    <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#4A2C1A", fontWeight: 700 }}>
                                      <input
                                        type="checkbox"
                                        checked={categoriaEditDraft.mostrar_en_home}
                                        onChange={(event) => setCategoriaEditDraft((prev) => ({ ...prev, mostrar_en_home: event.target.checked }))}
                                      />
                                      En Home
                                    </label>
                                  </div>
                                  <textarea
                                    className="adm-input"
                                    rows={2}
                                    placeholder="Descripcion"
                                    value={categoriaEditDraft.descripcion}
                                    onChange={(event) => setCategoriaEditDraft((prev) => ({ ...prev, descripcion: event.target.value }))}
                                    style={{ marginTop: "0.6rem" }}
                                  />
                                  <div className="adm-inline-points-actions">
                                    <button className="adm-btn-primary adm-btn-inline" disabled={busy} onClick={() => void guardarCategoriaEditada()}>
                                      {busy ? "Guardando..." : "Guardar cambios"}
                                    </button>
                                    <button className="adm-btn-secondary adm-btn-inline" onClick={cancelarEditarCategoria} disabled={busy}>
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
                <p className="adm-field-help" style={{ margin: 0 }}>Minimo 8 caracteres, con al menos 1 caracter especial y 1 numero.</p>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <FieldLabel text="Tipo de acceso" tip="Define que panel puede usar. Para crear mayoristas o empleados con descuentos, elegi Cliente y abajo cambia el perfil comercial." />
                  <select
                    className="adm-input"
                    value={nuevoUsuario.rol}
                    onChange={(event) =>
                      setNuevoUsuario((prev) => ({
                        ...prev,
                        rol: event.target.value as Rol,
                        tipo_cliente: event.target.value === "cliente" ? prev.tipo_cliente : "cliente",
                      }))
                    }
                  >
                    <option value="cliente">Cliente web</option>
                    <option value="vendedor">Vendedor</option>
                    {isSuperAdmin ? <option value="admin">Admin</option> : null}
                  </select>
                </label>
                {nuevoUsuario.rol === "cliente" ? (
                  <>
                    <input className="adm-input" placeholder="DNI" value={nuevoUsuario.dni} onChange={(event) => setNuevoUsuario((prev) => ({ ...prev, dni: event.target.value }))} />
                    <label style={{ display: "grid", gap: "0.35rem" }}>
                      <FieldLabel text="Perfil comercial" tip="Este perfil cambia los precios del catalogo segun los descuentos por categoria: cliente, mayorista o empleado." />
                      <select className="adm-input" value={nuevoUsuario.tipo_cliente} onChange={(event) => setNuevoUsuario((prev) => ({ ...prev, tipo_cliente: event.target.value as TipoCliente }))}>
                        <option value="cliente">Cliente</option>
                        <option value="mayorista">Mayorista</option>
                        <option value="empleado">Empleado</option>
                      </select>
                    </label>
                    <p className="adm-field-help" style={{ margin: 0 }}>
                      Mayorista y empleado son clientes web con precios especiales. Los descuentos se configuran desde Descuentos.
                    </p>
                  </>
                ) : null}
                <button className="adm-btn-primary" disabled={busy} onClick={crearUsuario}>
                  {busy ? "Creando..." : "Crear usuario"}
                </button>
              </div>
            </>
          ) : null}

          {false ? (
            <>{/*
              <SectionTitle title="TMP" />
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
                              accept={IMAGE_FILE_ACCEPT}
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
                                <img src={mediaUrl(url)} alt={`Foto ${index + 1}`} className="adm-page-image-thumb" />
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
            */}</>
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
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {tab === "politica-privacidad" ? (
            <>
              <SectionTitle title="Politica de Privacidad" />
              <div className="adm-page-editor-grid">
                <div className="adm-page-editor-col">
                  <div className="adm-notepad">
                    <div className="adm-notepad-header">
                      <p className="adm-notepad-header-title">Editor Markdown</p>
                      <span className="adm-notepad-md-badge">MD</span>
                    </div>
                    <div className="adm-notepad-body">
                      <p className="adm-md-hint">
                        Guia rapida Markdown: <code>#</code> titulo grande, <code>##</code> subtitulo, <code>-</code> listas,
                        <code> **texto** </code> negrita y <code>[texto](https://url)</code> para enlaces.
                      </p>
                      <input className="adm-notepad-title-input" value={politicaPrivacidadDraft.titulo} onChange={(event) => setPoliticaPrivacidadDraft((prev) => ({ ...prev, titulo: event.target.value }))} placeholder="Titulo" />
                      <textarea className="adm-notepad-textarea adm-page-textarea" value={politicaPrivacidadDraft.contenido} onChange={(event) => setPoliticaPrivacidadDraft((prev) => ({ ...prev, contenido: event.target.value }))} placeholder="Contenido en markdown" />
                    </div>
                    <div className="adm-notepad-footer">
                      <span className="adm-notepad-ok">{politicaPrivacidadDraft.okMsg}</span>
                      <span className="adm-notepad-err">{politicaPrivacidadDraft.errMsg}</span>
                      <button className="adm-notepad-save" onClick={() => guardarPagina("politica-privacidad")}>
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
                    <div className="adm-md-preview" dangerouslySetInnerHTML={{ __html: politicaPrivacidadHtml }} />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {tab === "arrepentimiento" ? (
            <>
              <SectionTitle title="Solicitudes de arrepentimiento" />
              <div className="adm-list-search" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  value={arrepentimientoSearch}
                  onChange={(event) => setArrepentimientoSearch(event.target.value)}
                  placeholder="Buscar por codigo, orden, nombre, email o telefono"
                />
                <span style={{ color: "#7b553a", fontWeight: 700 }}>
                  {arrepentimientoQuery.data?.total ?? 0} solicitud{(arrepentimientoQuery.data?.total ?? 0) === 1 ? "" : "es"}
                </span>
              </div>

              <div style={{ display: "grid", gap: "1rem" }}>
                {arrepentimientoQuery.isLoading ? (
                  <div className="adm-empty">Cargando solicitudes...</div>
                ) : arrepentimientoItems.length === 0 ? (
                  <div className="adm-empty">No hay solicitudes para mostrar.</div>
                ) : (
                  arrepentimientoItems.map((item) => {
                    const shortCode = item.codigo_tramite.split("-")[0] || item.codigo_tramite;
                    return (
                      <article key={item.codigo_tramite} className="admin-card" style={{ padding: "0.8rem 1.1rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <strong style={{ color: "#4A2C1A", fontSize: "1rem" }}>{item.nombre_apellido}</strong>
                            <span style={{ color: "#7b553a", fontSize: "0.85rem", fontWeight: 700 }}><code>{shortCode}{item.codigo_tramite.length > 12 ? "..." : ""}</code></span>
                          </div>
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <span style={{ fontSize: "0.85rem", color: "#7b553a", fontWeight: 700 }}>{formatDate(item.created_at)}</span>
                            <span style={{ fontSize: "0.85rem", color: item.estado === "Pendiente" ? "#e65100" : "#2e7d32", fontWeight: 700, textTransform: "capitalize" }}>{item.estado}</span>
                          </div>
                        </div>
                        <button type="button" className="adm-btn-secondary" onClick={() => setArrepentimientoModalItem(item)}>
                          Ver
                        </button>
                      </article>
                    );
                  })
                )}
              </div>

              <PaginationControls
                page={arrepentimientoPage}
                totalPages={arrepentimientoTotalPages}
                onPrev={() => setArrepentimientoPage((prev) => Math.max(1, prev - 1))}
                onNext={() => setArrepentimientoPage((prev) => Math.min(arrepentimientoTotalPages, prev + 1))}
              />
            </>
          ) : null}

          {tab === "layout-timeline" ? (
            <AdminLayoutTimeline />
          ) : null}

          {tab === "layout-donde" ? (
            <AdminLayoutDonde />
          ) : null}
        </div>
      </main>

      {cajaEditSesion ? (
        <div className="adm-modal-overlay" onClick={cancelarEdicionCaja}>
          <div
            className="adm-modal"
            style={{ maxWidth: 760, textAlign: "left", padding: "1.6rem" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <h3 className="adm-modal-title" style={{ margin: 0 }}>Editar caja historica</h3>
                <p className="adm-modal-desc" style={{ margin: 0 }}>
                  Caja del {cajaEditSesion.fecha_operativa} en {cajaEditSesion.sucursal_nombre}. Aqui puedes corregir apertura, observaciones y, si ya fue cerrada, el cierre declarado.
                </p>
              </div>
              <button
                type="button"
                className="adm-btn-secondary"
                onClick={cancelarEdicionCaja}
                disabled={busy}
                style={{ minWidth: "auto", flexShrink: 0, whiteSpace: "nowrap", padding: "0.7rem 1rem", alignSelf: "flex-start" }}
              >
                Cerrar
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
              <div className="admin-card" style={{ padding: "0.8rem" }}>
                <strong>Estado</strong>
                <p style={{ margin: "0.25rem 0 0" }}>{cajaEditSesion.estado === "cerrada" ? "Cerrada" : "Abierta"}</p>
              </div>
              <div className="admin-card" style={{ padding: "0.8rem" }}>
                <strong>Apertura</strong>
                <p style={{ margin: "0.25rem 0 0" }}>{formatMoney(cajaEditSesion.monto_apertura)}</p>
              </div>
              <div className="admin-card" style={{ padding: "0.8rem" }}>
                <strong>Efectivo sistema</strong>
                <p style={{ margin: "0.25rem 0 0" }}>{formatMoney(cajaEditSesion.summary.efectivoSistema)}</p>
              </div>
              <div className="admin-card" style={{ padding: "0.8rem" }}>
                <strong>Diferencia</strong>
                <p style={{ margin: "0.25rem 0 0" }}>
                  {cajaEditSesion.diferencia_cierre === null ? "-" : formatMoney(cajaEditSesion.diferencia_cierre)}
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gap: "0.85rem" }}>
              <div className="admin-card" style={{ padding: "0.95rem", display: "grid", gap: "0.75rem" }}>
                <div>
                  <strong>Editar apertura</strong>
                  <p className="adm-inline-tip" style={{ margin: "0.25rem 0 0" }}>
                    Corrige el efectivo inicial y la nota de apertura. El sistema recalculara el efectivo resultante de esta caja.
                  </p>
                </div>
                <div className="adm-form-grid">
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Monto inicial" tip="Carga el efectivo fisico con el que arranco esta caja." />
                    <input
                      className="adm-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={cajaMontoApertura}
                      onChange={(event) => setCajaMontoApertura(event.target.value)}
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <FieldLabel text="Nota de apertura" tip="Opcional. Sirve para dejar aclaraciones sobre el inicio de caja." />
                    <input
                      className="adm-input"
                      value={cajaObservacionesApertura}
                      onChange={(event) => setCajaObservacionesApertura(event.target.value)}
                      placeholder="Ej: fondo fijo contado al iniciar el dia"
                    />
                  </label>
                </div>
              </div>

              {cajaEditSesion.estado === "cerrada" ? (
                <div className="admin-card" style={{ padding: "0.95rem", display: "grid", gap: "0.75rem" }}>
                  <div>
                    <strong>Editar cierre declarado</strong>
                    <p className="adm-inline-tip" style={{ margin: "0.25rem 0 0" }}>
                      Ajusta el efectivo contado al cierre y la nota final para recalcular la diferencia de esta caja.
                    </p>
                  </div>
                  <div className="adm-form-grid">
                    <label style={{ display: "grid", gap: "0.35rem" }}>
                      <FieldLabel text="Monto contado al cierre" tip="Importe real contado en efectivo al cerrar esta caja." />
                      <input
                        className="adm-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={cajaMontoCierre}
                        onChange={(event) => setCajaMontoCierre(event.target.value)}
                      />
                    </label>
                    <label style={{ display: "grid", gap: "0.35rem" }}>
                      <FieldLabel text="Nota de cierre" tip="Observacion opcional para explicar diferencias o el arqueo." />
                      <input
                        className="adm-input"
                        value={cajaObservacionesCierre}
                        onChange={(event) => setCajaObservacionesCierre(event.target.value)}
                        placeholder="Ej: diferencia detectada al arqueo"
                      />
                    </label>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="adm-modal-actions" style={{ marginTop: "1.2rem" }}>
              <button className="adm-btn-secondary" onClick={cancelarEdicionCaja} disabled={busy}>
                Cancelar
              </button>
              <button className="adm-btn-primary" onClick={() => void guardarCajaEditada()} disabled={busy || !cajaSucursalId}>
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL DE CONFIRMACION */}
      {cancelacionOrden && (
        <div className="adm-modal-overlay">
          <div className="adm-modal" style={{ maxWidth: 620 }}>
            <div className="adm-modal-icon warning">!</div>
            <h3 className="adm-modal-title">Cancelar #{cancelacionOrden.orden.id}</h3>
            <p className="adm-modal-desc">
              Esto cancela la orden, devuelve stock si corresponde y envia un mensaje visible al cliente en soporte.
            </p>
            <div style={{ display: "grid", gap: "0.75rem", textAlign: "left" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <strong>Motivo para el cliente</strong>
                <textarea
                  className="adm-input"
                  rows={4}
                  value={cancelacionOrden.motivo}
                  onChange={(event) => setCancelacionOrden((prev) => prev ? { ...prev, motivo: event.target.value } : prev)}
                  placeholder="Ej: Tuvimos un problema de stock en sucursal y no podemos preparar el pedido a tiempo."
                />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <strong>Mensaje sobre devolucion</strong>
                <textarea
                  className="adm-input"
                  rows={3}
                  value={cancelacionOrden.mensaje_devolucion}
                  onChange={(event) => setCancelacionOrden((prev) => prev ? { ...prev, mensaje_devolucion: event.target.value } : prev)}
                />
              </label>
            </div>
            <div className="adm-modal-actions">
              <button className="adm-btn-secondary" onClick={() => setCancelacionOrden(null)} disabled={busy}>
                Volver
              </button>
              <button className="adm-btn-danger" onClick={() => void confirmarCancelacionUrgente()} disabled={busy || cancelacionOrden.motivo.trim().length < 8}>
                {busy ? "Cancelando..." : "Cancelar y avisar"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          {arrepentimientoModalItem ? (
        <div className="adm-modal-overlay" onClick={() => setArrepentimientoModalItem(null)}>
          <div className="adm-modal" style={{ maxWidth: 600, textAlign: "left", padding: "1.6rem" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.2rem", color: "#4A2C1A", margin: 0 }}>Detalle de Arrepentimiento</h2>
              <button className="adm-btn-secondary" style={{ padding: "0.2rem 0.6rem", fontSize: "1.2rem" }} onClick={() => setArrepentimientoModalItem(null)}>✕</button>
            </div>
            <div className="adm-modal-body" style={{ display: "grid", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <strong style={{ color: "#4A2C1A" }}>Nombre</strong>
                  <p style={{ margin: "0.2rem 0 0", color: "#5f4a39" }}>{arrepentimientoModalItem.nombre_apellido}</p>
                </div>
                <div>
                  <strong style={{ color: "#4A2C1A" }}>Pedido</strong>
                  <p style={{ margin: "0.2rem 0 0", color: "#5f4a39" }}>{arrepentimientoModalItem.numero_orden}</p>
                </div>
                <div>
                  <strong style={{ color: "#4A2C1A" }}>Codigo de trámite</strong>
                  <p style={{ margin: "0.2rem 0 0", color: "#5f4a39" }}><code>{arrepentimientoModalItem.codigo_tramite}</code></p>
                </div>
                <div>
                  <strong style={{ color: "#4A2C1A" }}>Estado actual</strong>
                  <p style={{ margin: "0.2rem 0 0", color: "#5f4a39", textTransform: "capitalize", fontWeight: 700 }}>
                    {arrepentimientoModalItem.estado}
                  </p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <strong style={{ color: "#4A2C1A" }}>Email</strong>
                  <p style={{ margin: "0.2rem 0 0", color: "#5f4a39", wordBreak: "break-all" }}>{arrepentimientoModalItem.email}</p>
                </div>
                <div>
                  <strong style={{ color: "#4A2C1A" }}>Telefono</strong>
                  <p style={{ margin: "0.2rem 0 0", color: "#5f4a39" }}>{arrepentimientoModalItem.telefono}</p>
                </div>
              </div>

              <div className="admin-card" style={{ padding: "0.95rem 1rem", background: "#fffaf4" }}>
                <strong style={{ color: "#4A2C1A" }}>Mensaje del cliente</strong>
                <p style={{ margin: "0.55rem 0 0", color: "#5f4a39", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{arrepentimientoModalItem.mensaje}</p>
              </div>

              <div style={{ borderTop: "1px solid #e9d5c5", paddingTop: "1rem" }}>
                <strong style={{ color: "#4A2C1A", display: "block", marginBottom: "0.5rem" }}>Cambiar estado</strong>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {["Pendiente", "Resuelto", "Desestimado"].map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={commandMutation.isPending || arrepentimientoModalItem.estado === st}
                      className={arrepentimientoModalItem.estado === st ? "adm-btn-primary" : "adm-btn-secondary"}
                      onClick={() => {
                        commandMutation.mutate(
                          { method: "patch", path: `/admin/arrepentimiento/${arrepentimientoModalItem.codigo_tramite}/estado`, body: { estado: st } },
                          {
                            onSuccess: () => {
                              arrepentimientoQuery.refetch();
                              statsQuery.refetch();
                              setArrepentimientoModalItem({ ...arrepentimientoModalItem, estado: st as any });
                              setEventbarMsg("Estado actualizado.");
                            },
                            onError: (err: any) => setEventbarErr(err?.message || "Error al actualizar estado")
                          }
                        );
                      }}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="adm-modal-actions" style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #e9d5c5", display: "flex", gap: "0.5rem" }}>
              <a
                href={`mailto:${arrepentimientoModalItem.email}`}
                className="adm-btn-secondary"
                style={{ textDecoration: "none" }}
              >
                Enviar email
              </a>
              <button
                type="button"
                className="adm-btn-secondary"
                onClick={() => {
                  const clientPhone = normalizeWhatsAppPhone(arrepentimientoModalItem.telefono);
                  const whatsappUrl = clientPhone ? buildWhatsAppUrl(clientPhone, buildArrepentimientoWhatsAppMessage(arrepentimientoModalItem)) : "";
                  if (whatsappUrl) window.open(whatsappUrl, "_blank", "noopener,noreferrer");
                  else setEventbarErr("El teléfono no es válido para WhatsApp");
                }}
              >
                WhatsApp
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}

