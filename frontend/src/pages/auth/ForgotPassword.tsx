import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "../../lib/apiBase";
import { getCsrfToken } from "../../lib/csrf";

async function requestPasswordReset(email: string): Promise<{ message: string }> {
  const res = await fetch(apiUrl("/api/auth/forgot-password"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": getCsrfToken(),
    },
    body: JSON.stringify({ email }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "No pudimos enviar el enlace.");
  }

  return body;
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");

  const forgotMutation = useMutation({
    mutationFn: () => requestPasswordReset(email.trim().toLowerCase()),
  });

  useEffect(() => {
    document.body.classList.add("auth-background");
    return () => {
      document.body.classList.remove("auth-background");
    };
  }, []);

  function submitForm(event: FormEvent) {
    event.preventDefault();
    forgotMutation.mutate();
  }

  return (
    <section className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="Nande" />
        </div>

        <h1 className="login-heading">Recuperar acceso</h1>
        <p className="login-subheading">Te enviamos un mail de recuperación</p>

        <form onSubmit={submitForm}>
          <label className="login-field-label">Correo electronico</label>
          <div className="login-input-group">
            <span className="login-input-icon">@</span>
            <input
              type="email"
              className="login-input"
              placeholder="tu@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {forgotMutation.error ? <p className="login-error">{forgotMutation.error.message}</p> : null}
          {forgotMutation.data ? <p className="login-info">{forgotMutation.data.message}</p> : null}

          <button type="submit" className="login-btn-primary" disabled={forgotMutation.isPending}>
            {forgotMutation.isPending ? "Enviando..." : "Enviar enlace"}
          </button>
        </form>

        <p className="login-footer">
          Ya recordaste tu contrasena? <Link to="/login">Inicia sesion</Link>
        </p>
      </div>
    </section>
  );
}
