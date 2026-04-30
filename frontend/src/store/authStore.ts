import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { apiUrl } from "../lib/apiBase";
import { getCsrfToken } from "../lib/csrf";
import type { AuthResponse, User } from "../types";

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
  isRestoringSession: boolean;
  hasRestoredSession: boolean;
  setSession: (session: AuthResponse) => void;
  logout: () => void;
  login: (payload: LoginPayload) => Promise<AuthResponse>;
  loginWithGoogle: (credential: string) => Promise<AuthResponse>;
  register: (payload: RegisterPayload) => Promise<AuthResponse>;
  updateUserPoints: (puntos: number) => void;
  updateUser: (patch: Partial<User>) => void;
  restoreSession: () => Promise<void>;
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
  const res = await fetch(apiUrl(`/api/auth/${path}`), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": getCsrfToken(),
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorMessage(body, "No se pudo completar la autenticacion."));
  }

  return body as AuthResponse;
}

async function requestLogout(token: string | null): Promise<void> {
  const headers: Record<string, string> = {
    "X-CSRF-Token": getCsrfToken(),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  await fetch(apiUrl("/api/auth/logout"), {
    method: "POST",
    credentials: "include",
    headers,
  }).catch(() => undefined);
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isRestoringSession: true,
      hasRestoredSession: false,

      setSession: ({ user, token }) => {
        set({ user, token: token ?? get().token, isRestoringSession: false, hasRestoredSession: true });
      },

      logout: () => {
        const token = get().token;
        set({ user: null, token: null, isRestoringSession: false, hasRestoredSession: true });
        void requestLogout(token);
      },

      login: async (payload) => {
        const session = await requestAuth("login", payload);
        set({ user: session.user, token: session.token ?? null, isRestoringSession: false, hasRestoredSession: true });
        return session;
      },

      loginWithGoogle: async (credential) => {
        const session = await requestAuth("google", { credential });
        set({ user: session.user, token: session.token ?? null, isRestoringSession: false, hasRestoredSession: true });
        return session;
      },

      register: async (payload) => {
        const session = await requestAuth("register", payload);
        set({ user: session.user, token: session.token ?? null, isRestoringSession: false, hasRestoredSession: true });
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

      restoreSession: async () => {
        set({ isRestoringSession: true });

        const storedToken = get().token;
        const headers: Record<string, string> = {};
        if (storedToken) headers["Authorization"] = `Bearer ${storedToken}`;

        const response = await fetch(apiUrl("/api/auth/me"), {
          method: "GET",
          credentials: "include",
          headers,
        }).catch(() => null);

        if (!response || !response.ok) {
          set({ user: null, token: null, isRestoringSession: false, hasRestoredSession: true });
          return;
        }

        const body = (await response.json().catch(() => null)) as AuthResponse | null;
        if (!body?.user) {
          set({ user: null, token: null, isRestoringSession: false, hasRestoredSession: true });
          return;
        }

        set({ user: body.user, isRestoringSession: false, hasRestoredSession: true });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
    },
  ),
);
