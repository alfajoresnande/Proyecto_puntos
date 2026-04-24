import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AuthResponse, User } from "../types";
import { isTokenExpired } from "../lib/auth";

type LoginPayload = {
  email: string;
  password: string;
};

type RegisterPayload = {
  nombre: string;
  dni: string;
  email: string;
  password: string;
  codigo_invitacion_usado?: string | null;
};

type GoogleLoginPayload = {
  credential: string;
};

type AuthStore = {
  user: User | null;
  token: string | null;
  setSession: (session: AuthResponse) => void;
  logout: () => void;
  login: (payload: LoginPayload) => Promise<AuthResponse>;
  loginWithGoogle: (credential: string) => Promise<AuthResponse>;
  register: (payload: RegisterPayload) => Promise<AuthResponse>;
  updateUserPoints: (puntos: number) => void;
  updateUser: (patch: Partial<User>) => void;
  validateSession: () => boolean;
};

const STORAGE_KEY = "nande-auth";

function parseErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string") return err;
  }
  return fallback;
}

async function requestAuth(path: string, payload: LoginPayload | RegisterPayload | GoogleLoginPayload): Promise<AuthResponse> {
  const res = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorMessage(body, "No se pudo completar la autenticacion."));
  }

  return body as AuthResponse;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,

      setSession: ({ user, token }) => {
        set({ user, token });
      },

      logout: () => {
        set({ user: null, token: null });
      },

      login: async (payload) => {
        const session = await requestAuth("login", payload);
        set({ user: session.user, token: session.token });
        return session;
      },

      loginWithGoogle: async (credential) => {
        const session = await requestAuth("google", { credential });
        set({ user: session.user, token: session.token });
        return session;
      },

      register: async (payload) => {
        const session = await requestAuth("register", payload);
        set({ user: session.user, token: session.token });
        return session;
      },

      updateUserPoints: (puntos) => {
        const user = get().user;
        if (!user) return;
        set({ user: { ...user, puntos_saldo: puntos } });
      },

      updateUser: (patch) => {
        const user = get().user;
        if (!user) return;
        set({ user: { ...user, ...patch } });
      },

      validateSession: () => {
        const { token } = get();
        if (!token) return false;
        if (isTokenExpired(token)) {
          set({ user: null, token: null });
          return false;
        }
        return true;
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
    },
  ),
);
