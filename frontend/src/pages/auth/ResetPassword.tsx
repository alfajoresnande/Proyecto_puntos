import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiUrl } from "../../lib/apiBase";
import { csrfFetch } from "../../lib/csrf";
import { createApiError, useRetryAfterCooldown } from "../../lib/rateLimitError";

async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  const res = await csrfFetch(apiUrl("/api/auth/reset-password"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, new_password: newPassword }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw createApiError(body, "No pudimos actualizar tu contrasena.");
  }

  return body;
}

function validatePassword(value: string): string | null {
  if (value.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[^A-Za-z0-9]/.test(value)) return "La contraseña debe incluir al menos 1 caracter especial.";
  if (!/\d/.test(value)) return "La contraseña debe incluir al menos un número.";
  return null;
}

export function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");
  const { cooldownSeconds, cooldownMessage, startCooldownFromError } = useRetryAfterCooldown();

  const resetMutation = useMutation({
    mutationFn: () => resetPassword(token, password),
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

  useEffect(() => {
    if (!resetMutation.data) return;
    const timer = window.setTimeout(() => {
      navigate("/login", { replace: true });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [navigate, resetMutation.data]);

  function submitForm(event: FormEvent) {
    event.preventDefault();
    setLocalError("");

    if (!token) {
      setLocalError("El enlace no tiene token de recuperación.");
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setLocalError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setLocalError("Las contraseñas no coinciden.");
      return;
    }

    resetMutation.mutate();
  }

  return (
    <section className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="Nande" />
        </div>

        <h1 className="login-heading">Nueva contraseña</h1>
        <p className="login-subheading">Crea una clave segura para volver a ingresar</p>

        <form onSubmit={submitForm}>
          <label className="login-field-label">Contraseña nueva</label>
          <div className="login-input-group">
            <span className="login-input-icon">*</span>
            <input
              type={showPassword ? "text" : "password"}
              className="login-input login-input-password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
            <button type="button" className="login-input-toggle" onClick={() => setShowPassword((prev) => !prev)}>
              {showPassword ? "Ocultar" : "Ver"}
            </button>
          </div>

          <label className="login-field-label">Confirmar contraseña</label>
          <div className="login-input-group">
            <span className="login-input-icon">*</span>
            <input
              type={showPassword ? "text" : "password"}
              className="login-input login-input-password"
              placeholder="Repetí tu contraseña"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {localError ? <p className="login-error">{localError}</p> : null}
          {cooldownMessage ? <p className="login-error">{cooldownMessage}</p> : null}
          {!cooldownMessage && resetMutation.error ? <p className="login-error">{resetMutation.error.message}</p> : null}
          {resetMutation.data ? (
            <p className="login-info">{resetMutation.data.message} Te llevamos al login en 5 segundos.</p>
          ) : null}

          <button
            type="submit"
            className="login-btn-primary"
            disabled={resetMutation.isPending || Boolean(resetMutation.data) || cooldownSeconds > 0}
          >
            {resetMutation.isPending ? "Actualizando..." : cooldownSeconds > 0 ? "Espera para reintentar" : "Actualizar contraseña"}
          </button>
        </form>

        <p className="login-footer">
          {resetMutation.data ? <Link to="/login">Ir al login</Link> : <Link to="/forgot-password">Pedir otro enlace</Link>}
        </p>
      </div>
    </section>
  );
}
