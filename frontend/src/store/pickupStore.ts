import { create } from "zustand";

const STORAGE_KEY = "sucursal_retiro_id";

function readStoredSucursalId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

function persistSucursalId(value: string) {
  if (typeof window === "undefined") return;
  const nextValue = value.trim();
  if (nextValue) {
    window.localStorage.setItem(STORAGE_KEY, nextValue);
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}

type PickupStore = {
  sucursalRetiroId: string;
  setSucursalRetiroId: (value: string) => void;
};

export const usePickupStore = create<PickupStore>((set) => ({
  sucursalRetiroId: readStoredSucursalId(),
  setSucursalRetiroId: (value) => {
    persistSucursalId(value);
    set({ sucursalRetiroId: value.trim() });
  },
}));
