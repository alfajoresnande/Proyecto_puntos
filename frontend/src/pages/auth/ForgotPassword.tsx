import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "../../lib/apiBase";
import { csrfFetch } from "../../lib/csrf";
import { createApiError, useRetryAfterCooldown } from "../../lib/rateLimitError";

async function requestPasswordReset(email: string): Promise<{ message: string }> {
  const res = await csrfFetch(apiUrl("/api/auth/forgot-password"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw createApiError(body, "No pudimos enviar el enlace.");
  }

  return body;
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const { cooldownSeconds, cooldownMessage, startCooldownFromError } = useRetryAfterCooldown();

  const forgotMutation = useMutation({
    mutationFn: () => requestPasswordReset(email.trim().toLowerCase()),
    onError: (error) => {
      startCooldownFromError(error);
    },
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
        <p className="login-subheading">Te enviamos un enlace para crear una nueva contraseña</p>

        <form onSubmit={submitForm}>
          <label className="login-field-label">Correo electrónico</label>
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

          {cooldownMessage ? <p className="login-error">{cooldownMessage}</p> : null}
          {!cooldownMessage && forgotMutation.error ? <p className="login-error">{forgotMutation.error.message}</p> : null}
          {forgotMutation.data ? (
            <div className="login-info">
              <p>{forgotMutation.data.message}</p>
              <p>Si no lo ves en unos minutos, revisá Spam o Correo no deseado.</p>
            </div>
          ) : null}

          <button type="submit" className="login-btn-primary" disabled={forgotMutation.isPending || cooldownSeconds > 0}>
            {forgotMutation.isPending ? "Enviando..." : cooldownSeconds > 0 ? "Espera para reintentar" : "Enviar enlace"}
          </button>
        </form>

        <p className="login-footer">
          ¿Ya recordaste tu contraseña? <Link to="/login">Inicia sesión</Link>
        </p>
      </div>
    </section>
  );
}
