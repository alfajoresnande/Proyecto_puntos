import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { apiUrl } from "../lib/apiBase";
import { getCsrfToken, refreshCsrfToken } from "../lib/csrf";
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

async function postAuth(path: string, body: unknown, csrfToken: string): Promise<Response> {
  return fetch(apiUrl(`/api/auth/${path}`), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(body),
  });
}

async function requestAuth<TResponse>(
  path: string,
  payload: LoginPayload | RegisterPayload | GoogleLoginPayload | VerifyEmailPayload | ResendEmailVerificationPayload,
): Promise<TResponse> {
  let res = await postAuth(path, payload, getCsrfToken());

  // El token CSRF esta atado a la sesion; en el arranque puede no haberlo
  // todavia. Se pide uno y se reintenta una sola vez.
  if (res.status === 403) {
    res = await postAuth(path, payload, await refreshCsrfToken());
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw createApiError(body, "No se pudo completar la autenticacion.");
  }

  return body as TResponse;
}

/**
 * SEC-03: no hay token que mandar. El logout se autentica con la cookie
 * HttpOnly y el backend revoca el `jti` de esta sesion.
 */
async function requestLogout(): Promise<void> {
  const enviar = (csrfToken: string) =>
    fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    });

  try {
    const res = await enviar(getCsrfToken());
    if (res.status === 403) await enviar(await refreshCsrfToken());
  } catch {
    // Si falla la red, la sesion se invalida igual cuando expire el token.
  }
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      isRestoringSession: true,
      hasRestoredSession: false,

      setSession: ({ user }) => {
        set({ user, isRestoringSession: false, hasRestoredSession: true });
      },

      logout: () => {
        set({ user: null, isRestoringSession: false, hasRestoredSession: true });
        // Limpia el carrito para que items del usuario anterior no aparezcan
        // si otra persona inicia sesión en el mismo navegador.
        useCartStore.getState().clear();
        void requestLogout();
        // La sesión cambió: el token CSRF anterior ya no vale.
        void refreshCsrfToken();
      },

      login: async (payload) => {
        const session = await requestAuth<AuthResponse>("login", payload);
        set({ user: session.user, isRestoringSession: false, hasRestoredSession: true });
        // Nueva sesión → nuevo token CSRF ligado a ella.
        void refreshCsrfToken();
        return session;
      },

      loginWithGoogle: async (credential) => {
        const payload: GoogleLoginPayload = { credential };
        const session = await requestAuth<AuthResponse>("google", payload);
        set({ user: session.user, isRestoringSession: false, hasRestoredSession: true });
        void refreshCsrfToken();
        return session;
      },

      register: async (payload) => {
        const response = await requestAuth<RegisterResponse>("register", payload);
        set({ user: null, isRestoringSession: false, hasRestoredSession: true });
        return response;
      },

      verifyEmail: async (payload) => {
        const session = await requestAuth<AuthResponse>("verify-email", payload);
        set({ user: session.user, isRestoringSession: false, hasRestoredSession: true });
        void refreshCsrfToken();
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
        // SEC-03: no hay token que leer. La cookie HttpOnly viaja sola con
        // `credentials: "include"` y el servidor decide si la sesión sigue viva.
        set({ isRestoringSession: true });

        let response: Response | null = null;
        try {
          response = await fetch(apiUrl("/api/auth/me"), {
            method: "GET",
            credentials: "include",
          });
        } catch {
          // Error de red (sin señal, CORS, timeout): NO borrar la sesión.
          // En el próximo intento se revalida.
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
          set({ user: null, isRestoringSession: false, hasRestoredSession: true });
          return;
        }

        set({ user: body.user, isRestoringSession: false, hasRestoredSession: true });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // SEC-03: solo se persiste el perfil visible. Nunca un token.
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
