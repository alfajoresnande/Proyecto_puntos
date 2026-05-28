import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { apiUrl } from "../lib/apiBase";
import { getCsrfToken } from "../lib/csrf";
import { createApiError } from "../lib/rateLimitError";
import { useCartStore } from "./cartStore";
import type { AuthResponse, RegisterResponse, User } from "../types";

type LoginPayload = {
  email: string;
  password: string;
};

type RegisterPayload = {
  nombre: string;
  email: string;
  password: string;
  codigo_invitacion_usado?: string | null;
  accepted_terms: true;
};

type GoogleLoginPayload = {
  credential: string;
};

type VerifyEmailPayload = {
  email: string;
  code: string;
};

type ResendEmailVerificationPayload = {
  email: string;
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
  register: (payload: RegisterPayload) => Promise<RegisterResponse>;
  verifyEmail: (payload: VerifyEmailPayload) => Promise<AuthResponse>;
  resendEmailVerification: (payload: ResendEmailVerificationPayload) => Promise<{ ok: boolean; message?: string }>;
  updateUserPoints: (puntos: number) => void;
  updateUser: (patch: Partial<User>) => void;
  restoreSession: () => Promise<void>;
};

const STORAGE_KEY = "nande-auth";

async function requestAuth<TResponse>(
  path: string,
  payload: LoginPayload | RegisterPayload | GoogleLoginPayload | VerifyEmailPayload | ResendEmailVerificationPayload,
): Promise<TResponse> {
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
    throw createApiError(body, "No se pudo completar la autenticacion.");
  }

  return body as TResponse;
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
        // Limpia el carrito para que items del usuario anterior no aparezcan
        // si otra persona inicia sesión en el mismo navegador.
        useCartStore.getState().clear();
        void requestLogout(token);
      },

      login: async (payload) => {
        const session = await requestAuth<AuthResponse>("login", payload);
        set({ user: session.user, token: session.token ?? null, isRestoringSession: false, hasRestoredSession: true });
        return session;
      },

      loginWithGoogle: async (credential) => {
        const payload: GoogleLoginPayload = { credential };
        const session = await requestAuth<AuthResponse>("google", payload);
        set({ user: session.user, token: session.token ?? null, isRestoringSession: false, hasRestoredSession: true });
        return session;
      },

      register: async (payload) => {
        const response = await requestAuth<RegisterResponse>("register", payload);
        set({ user: null, token: null, isRestoringSession: false, hasRestoredSession: true });
        return response;
      },

      verifyEmail: async (payload) => {
        const session = await requestAuth<AuthResponse>("verify-email", payload);
        set({ user: session.user, token: session.token ?? null, isRestoringSession: false, hasRestoredSession: true });
        return session;
      },

      resendEmailVerification: async (payload) => {
        return requestAuth<{ ok: boolean; message?: string }>("resend-email-verification", payload);
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
        // IMPORTANTE: leer el token ANTES de llamar a set().
        // set() dispara el middleware persist que sobreescribe localStorage con el estado
        // actual del store (token: null durante la race condition de hidratación).
        // Si leemos después del set(), ya perdimos el token de localStorage.
        let storedToken: string | null = get().token;
        if (!storedToken) {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as { state?: { token?: unknown } };
              if (typeof parsed?.state?.token === "string") {
                storedToken = parsed.state.token;
              }
            }
          } catch {
            // ignore — si falla el parse no tenemos token
          }
        }

        set({ isRestoringSession: true });

        const headers: Record<string, string> = {};
        if (storedToken) headers["Authorization"] = `Bearer ${storedToken}`;

        let response: Response | null = null;
        try {
          response = await fetch(apiUrl("/api/auth/me"), {
            method: "GET",
            credentials: "include",
            headers,
          });
        } catch {
          // Error de red (sin señal, CORS, timeout): NO borrar la sesión.
          // El usuario sigue logueado en localStorage; en el próximo intento se revalida.
          set({ isRestoringSession: false, hasRestoredSession: true });
          return;
        }

        // Error de servidor (5xx, etc.): tampoco borrar la sesión.
        if (!response.ok) {
          set({ isRestoringSession: false, hasRestoredSession: true });
          return;
        }

        const body = (await response.json().catch(() => null)) as AuthResponse | null;

        // El servidor confirmó explícitamente que no hay sesión válida → limpiar todo.
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
