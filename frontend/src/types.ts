export type Rol = "admin" | "vendedor" | "cliente";

export type User = {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  dni: string | null;
  telefono?: string | null;
  puntos_saldo: number;
  codigo_invitacion: string | null;
  referido_por?: number | null;
};

export type AuthResponse = {
  token: string;
  user: User;
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
  activo?: boolean;
};
