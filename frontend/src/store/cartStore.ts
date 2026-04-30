import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type CartItems = Record<number, number>;

type CartStore = {
  items: CartItems;
  add: (productoId: number, cantidad?: number) => void;
  increment: (productoId: number) => void;
  decrement: (productoId: number) => void;
  clear: () => void;
};

const STORAGE_KEY = "nande-cart";

export const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
      items: {},
      add: (productoId, cantidad = 1) => {
        const safe = Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 1;
        set((state) => ({
          items: { ...state.items, [productoId]: (state.items[productoId] || 0) + safe },
        }));
      },
      increment: (productoId) => {
        set((state) => ({
          items: { ...state.items, [productoId]: (state.items[productoId] || 0) + 1 },
        }));
      },
      decrement: (productoId) => {
        set((state) => {
          const next = { ...state.items };
          const actual = next[productoId] || 0;
          if (actual <= 1) delete next[productoId];
          else next[productoId] = actual - 1;
          return { items: next };
        });
      },
      clear: () => set({ items: {} }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
