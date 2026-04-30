import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type CartItem = {
  producto_id: number;
  nombre: string;
  puntos_requeridos: number;
  imagen_url: string | null;
  cantidad: number;
};

type ProductoInfo = {
  id: number;
  nombre: string;
  puntos_requeridos: number | null;
  imagen_url?: string | null;
};

type CartStore = {
  items: Record<number, CartItem>;
  pendingCanje: boolean;
  add: (producto: ProductoInfo, cantidad?: number) => void;
  increment: (productoId: number) => void;
  decrement: (productoId: number) => void;
  clear: () => void;
  requestCanje: () => void;
  consumePendingCanje: () => void;
};

const STORAGE_KEY = "nande-cart";

export const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
      items: {},
      pendingCanje: false,
      add: (producto, cantidad = 1) => {
        const safe = Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 1;
        set((state) => {
          const existing = state.items[producto.id];
          const nuevaCantidad = (existing?.cantidad || 0) + safe;
          return {
            items: {
              ...state.items,
              [producto.id]: {
                producto_id: producto.id,
                nombre: producto.nombre,
                puntos_requeridos: producto.puntos_requeridos || 0,
                imagen_url: producto.imagen_url ?? null,
                cantidad: nuevaCantidad,
              },
            },
          };
        });
      },
      increment: (productoId) => {
        set((state) => {
          const existing = state.items[productoId];
          if (!existing) return state;
          return {
            items: {
              ...state.items,
              [productoId]: { ...existing, cantidad: existing.cantidad + 1 },
            },
          };
        });
      },
      decrement: (productoId) => {
        set((state) => {
          const existing = state.items[productoId];
          if (!existing) return state;
          const next = { ...state.items };
          if (existing.cantidad <= 1) delete next[productoId];
          else next[productoId] = { ...existing, cantidad: existing.cantidad - 1 };
          return { items: next };
        });
      },
      clear: () => set({ items: {} }),
      requestCanje: () => set({ pendingCanje: true }),
      consumePendingCanje: () => set({ pendingCanje: false }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Solo persistir items, no el flag pendingCanje
      partialize: (state) => ({ items: state.items }),
      // Bump de versión para invalidar el formato anterior (Record<number, number>)
      version: 2,
    },
  ),
);
