export type Rol = "admin" | "superAdmin" | "vendedor" | "cliente";

export type User = {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
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
  imagenes?: string[];
  categoria: string | null;
  puntos_requeridos: number;
  puntos_acumulables: number | null;
  puntaje_al_comprar?: number | null;
  destacado_home?: boolean;
  tipo_producto?: "canje" | "venta" | "mixto";
  precio_dinero?: number | string | null;
  precio_puntos?: number | null;
  puntos_para_canjear?: number | null;
  stock_disponible?: number;
  stock_reservado?: number;
  stock_total_disponible?: number;
  stock_total_reservado?: number;
  stock_sucursal_id?: number | null;
  inventario_sucursales?: Array<{
    sucursal_id: number;
    sucursal_nombre: string;
    stock_disponible: number;
    stock_reservado: number;
  }>;
  track_stock?: boolean;
  permite_envio?: boolean;
  permite_retiro_local?: boolean;
  activo?: boolean;
};
