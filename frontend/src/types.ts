export type Rol = "admin" | "superAdmin" | "vendedor" | "cliente";
export type TipoCliente = "cliente" | "mayorista" | "empleado";

export type User = {
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
  referido_por?: number | null;
};

export type AuthResponse = {
  user: User;
  token?: string;
};

export type RegisterResponse = {
  ok: boolean;
  email: string;
  verification_required: boolean;
  message?: string;
};

export type Producto = {
  id: number;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
  imagen_mobile_url?: string | null;
  imagenes?: string[];
  categoria: string | null;
  puntos_requeridos: number;
  puntos_acumulables: number | null;
  puntaje_al_comprar?: number | null;
  destacado_home?: boolean;
  tipo_producto?: "canje" | "venta" | "mixto";
  configuracion_tipo?: "simple" | "caja_sabores";
  capacidad_sabores?: number | null;
  sabor_ids?: number[];
  sabores?: Array<{
    id: number;
    nombre: string;
  }>;
  sabores_disponibles?: Array<{
    id: number;
    nombre: string;
    descripcion?: string | null;
    activo?: boolean;
    stock_disponible?: number;
    stock_reservado?: number;
  }>;
  precio_dinero?: number | string | null;
  precio_dinero_original?: number | null;
  precio_dinero_lista?: number | null;
  descuento_porcentaje_aplicado?: number;
  descuento_producto_porcentaje?: number;
  tipo_cliente_precio?: TipoCliente;
  promo_eventbar_activa?: boolean;
  promo_eventbar_tipo?: "2x1" | "3x2" | "4x3" | null;
  promo_eventbar_label?: string | null;
  promo_eventbar_cantidad_requerida?: number | null;
  promo_eventbar_cantidad_paga?: number | null;
  promo_eventbar_precio_efectivo?: number | null;
  promo_eventbar_precio_pack?: number | null;
  precio_puntos?: number | null;
  puntos_para_canjear?: number | null;
  stock_disponible?: number;
  stock_reservado?: number;
  stock_total_disponible?: number;
  stock_total_reservado?: number;
  limite_compra?: number | null;
  stock_sucursal_id?: number | null;
  inventario_sucursales?: Array<{
    sucursal_id: number;
    sucursal_nombre: string;
    stock_disponible: number;
    stock_reservado: number;
  }>;
  track_stock?: boolean;
  permite_envio?: boolean;
  envio_gratis?: boolean;
  permite_retiro_local?: boolean;
  activo?: boolean;
};

export type AddressProvider = "manual" | "geoapify" | "google";

export type UserAddress = {
  id: number;
  usuario_id: number;
  alias: string | null;
  receptor_nombre: string | null;
  receptor_telefono: string | null;
  direccion_formateada: string;
  calle: string | null;
  numero: string | null;
  piso_departamento: string | null;
  barrio: string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_postal: string | null;
  pais: string;
  lat: number;
  lng: number;
  provider: AddressProvider;
  provider_place_id: string | null;
  provider_raw_json: unknown;
  instrucciones_entrega: string | null;
  es_predeterminada: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type UserAddressPayload = {
  alias?: string | null;
  receptor_nombre?: string | null;
  receptor_telefono?: string | null;
  direccion_formateada: string;
  calle?: string | null;
  numero?: string | null;
  piso_departamento?: string | null;
  barrio?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  pais?: string | null;
  lat: number;
  lng: number;
  provider?: AddressProvider | null;
  provider_place_id?: string | null;
  provider_raw_json?: unknown;
  instrucciones_entrega?: string | null;
  es_predeterminada?: boolean | null;
};

export type ShippingPolygonGeoJson = {
  type: "Polygon";
  coordinates: number[][][];
};

export type ShippingZone = {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  prioridad: number;
  color: string;
  polygon_geojson: ShippingPolygonGeoJson;
  activo: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type ShippingZonePayload = {
  nombre: string;
  descripcion?: string | null;
  precio: number;
  prioridad?: number | null;
  color?: string | null;
  polygon_geojson: ShippingPolygonGeoJson;
  activo?: boolean | null;
};

export type ShippingQuote = {
  disponible: boolean;
  costo_envio: number;
  costo_envio_original?: number;
  envio_gratis?: boolean;
  envio_gratis_motivo?: "productos" | "monto_minimo" | null;
  envio_gratis_monto_minimo?: number | null;
  zona: null | {
    id: number;
    nombre: string;
    precio: number;
    prioridad: number;
    color: string;
  };
  error?: string;
};
