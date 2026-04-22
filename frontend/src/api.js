const BASE = "/api";

function token() {
  return localStorage.getItem("token");
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    // Para endpoints de auth el 401 significa credenciales incorrectas, no sesión expirada
    const isAuthPath = path.startsWith("/auth/");
    if (!isAuthPath) {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      if (window.Alpine) {
        const auth = window.Alpine.store("auth");
        if (auth?.user) auth.user = null;
      }
      window.location.hash = "/login";
    }
    let msg = isAuthPath ? "Email o contraseña incorrectos." : "Sesión expirada. Iniciá sesión nuevamente.";
    try {
      const body = await res.json();
      if (body?.error) msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
    } catch {}
    throw new Error(msg);
  }

  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) {
        msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
      }
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get:   (p)       => request(p),
  post:  (p, body) => request(p, { method: "POST",   body: JSON.stringify(body) }),
  put:   (p, body) => request(p, { method: "PUT",    body: JSON.stringify(body) }),
  patch: (p, body) => request(p, { method: "PATCH",  body: JSON.stringify(body) }),
  del:   (p)       => request(p, { method: "DELETE" }),
};
