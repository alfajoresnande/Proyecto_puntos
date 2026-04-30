import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCsrfToken } from "../../lib/csrf";

async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": getCsrfToken(),
    },
    body: JSON.stringify({ token, new_password: newPassword }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "No pudimos actualizar tu contrasena.");
  }

  return body;
}

function validatePassword(value: string): string | null {
  if (value.length < 12) return "La contrasena debe tener al menos 12 caracteres.";
  if (!/[A-Za-z]/.test(value)) return "La contrasena debe incluir al menos una letra.";
  if (!/\d/.test(value)) return "La contrasena debe incluir al menos un numero.";
  return null;
}

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");

  const resetMutation = useMutation({
    mutationFn: () => resetPassword(token, password),
  });

  useEffect(() => {
    document.body.classList.add("auth-background");
    return () => {
      document.body.classList.remove("auth-background");
    };
  }, []);

  function submitForm(event: FormEvent) {
    event.preventDefault();
    setLocalError("");

    if (!token) {
      setLocalError("El enlace no tiene token de recuperacion.");
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setLocalError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setLocalError("Las contrasenas no coinciden.");
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

        <h1 className="login-heading">Nueva contrasena</h1>
        <p className="login-subheading">Crea una clave segura para volver a ingresar</p>

        <form onSubmit={submitForm}>
          <label className="login-field-label">Contrasena nueva</label>
          <div className="login-input-group">
            <span className="login-input-icon">*</span>
            <input
              type={showPassword ? "text" : "password"}
              className="login-input login-input-password"
              placeholder="Minimo 12 caracteres"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
            <button type="button" className="login-input-toggle" onClick={() => setShowPassword((prev) => !prev)}>
              {showPassword ? "Ocultar" : "Ver"}
            </button>
          </div>

          <label className="login-field-label">Confirmar contrasena</label>
          <div className="login-input-group">
            <span className="login-input-icon">*</span>
            <input
              type={showPassword ? "text" : "password"}
              className="login-input login-input-password"
              placeholder="Repeti tu contrasena"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {localError ? <p className="login-error">{localError}</p> : null}
          {resetMutation.error ? <p className="login-error">{resetMutation.error.message}</p> : null}
          {resetMutation.data ? <p className="login-info">{resetMutation.data.message}</p> : null}

          <button type="submit" className="login-btn-primary" disabled={resetMutation.isPending || Boolean(resetMutation.data)}>
            {resetMutation.isPending ? "Actualizando..." : "Actualizar contrasena"}
          </button>
        </form>

        <p className="login-footer">
          {resetMutation.data ? <Link to="/login">Ir al login</Link> : <Link to="/forgot-password">Pedir otro enlace</Link>}
        </p>
      </div>
    </section>
  );
}
