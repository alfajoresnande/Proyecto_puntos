import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { defaultRouteForRole } from "../../lib/auth";
import { useAuthStore } from "../../store/authStore";

function passwordValidationErrors(value: string): string[] {
  const errors: string[] = [];
  if (value.length < 8) errors.push("Minimo 8 caracteres");
  if (!(value.match(/\d/g)?.length && value.match(/\d/g)!.length >= 3)) {
    errors.push("Al menos 3 numeros");
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) {
    errors.push("Al menos 1 caracter especial");
  }
  return errors;
}

export function Registro() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const register = useAuthStore((state) => state.register);

  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [codigoInvitacion, setCodigoInvitacion] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [localError, setLocalError] = useState("");
  const [showOptionalCode, setShowOptionalCode] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const redirectTimerRef = useRef<number | null>(null);

  const registerMutation = useMutation({
    mutationFn: () =>
      register({
        nombre: nombre.trim(),
        dni: dni.trim(),
        email: email.trim(),
        password,
        codigo_invitacion_usado: codigoInvitacion.trim() ? codigoInvitacion.trim().toUpperCase() : null,
      }),
    onSuccess: () => {
      setShowSuccessToast(true);
      redirectTimerRef.current = window.setTimeout(() => {
        navigate("/cliente");
      }, 1400);
    },
  });

  useEffect(() => {
    document.body.classList.add("auth-background");
    return () => {
      document.body.classList.remove("auth-background");
    };
  }, []);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  if (user) {
    return <Navigate to={defaultRouteForRole(user.rol)} replace />;
  }

  const passwordErrors = passwordValidationErrors(password);

  function submitForm(event: FormEvent) {
    event.preventDefault();
    setLocalError("");

    if (!nombre.trim()) {
      setLocalError("El nombre es obligatorio.");
      return;
    }
    if (!dni.trim() || dni.trim().length < 6) {
      setLocalError("El DNI debe tener al menos 6 digitos.");
      return;
    }
    if (passwordErrors.length > 0) {
      setLocalError(`Contrasena invalida: ${passwordErrors.join(", ")}.`);
      return;
    }
    if (password !== confirmPassword) {
      setLocalError("Las contrasenas no coinciden.");
      return;
    }

    registerMutation.mutate();
  }

  return (
    <section className="login-page">
      {showSuccessToast ? <div className="auth-floating-toast">Cuenta creada con exito. Redirigiendo...</div> : null}
      <div className="login-card login-card-register-compact">
        <div className="login-logo" style={{ marginBottom: "0.75rem" }}>
          <img src="/logo.png" alt="Nande" style={{ height: "64px" }} />
        </div>

        <h1 className="login-heading" style={{ fontSize: "1.6rem", marginBottom: "0.2rem" }}>Crear cuenta</h1>
        <p className="login-subheading" style={{ marginBottom: "1.25rem" }}>Registrate como cliente para acumular puntos</p>

        <form onSubmit={submitForm}>
          <label className="login-field-label">Nombre completo</label>
          <div className="login-input-group" style={{ marginBottom: "0.85rem" }}>
            <input
              type="text"
              className="login-input login-input-noicon register-input-sm"
              placeholder="Ingresa tu nombre completo"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              required
            />
          </div>

          <label className="login-field-label">DNI</label>
          <div className="login-input-group" style={{ marginBottom: "0.85rem" }}>
            <input
              type="text"
              inputMode="numeric"
              className="login-input login-input-noicon register-input-sm"
              placeholder="Ingresa tu DNI"
              value={dni}
              onChange={(event) => setDni(event.target.value.replace(/\D/g, ""))}
              maxLength={15}
              required
            />
          </div>

          <label className="login-field-label">Correo electronico</label>
          <div className="login-input-group" style={{ marginBottom: "0.85rem" }}>
            <input
              type="email"
              className="login-input login-input-noicon register-input-sm"
              placeholder="Ingresa tu correo"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <label className="login-field-label">Contrasena</label>
          <div className="login-input-group" style={{ marginBottom: "0.35rem" }}>
            <input
              type={showPassword ? "text" : "password"}
              className="login-input login-input-noicon register-input-sm login-input-password"
              placeholder="Ingresa tu contrasena"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="button" className="login-input-toggle" onClick={() => setShowPassword((prev) => !prev)}>
              {showPassword ? "Ocultar" : "Ver"}
            </button>
          </div>
          <p className="register-pass-hint">Minimo 8 caracteres, 3 numeros y 1 caracter especial.</p>

          <label className="login-field-label">Confirmar contrasena</label>
          <div className="login-input-group" style={{ marginBottom: "0.85rem" }}>
            <input
              type={showConfirmPassword ? "text" : "password"}
              className="login-input login-input-noicon register-input-sm login-input-password"
              placeholder="Repite tu contrasena"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
            <button type="button" className="login-input-toggle" onClick={() => setShowConfirmPassword((prev) => !prev)}>
              {showConfirmPassword ? "Ocultar" : "Ver"}
            </button>
          </div>

          <button
            type="button"
            className="register-optional-btn"
            onClick={() => setShowOptionalCode((prev) => !prev)}
          >
            {showOptionalCode ? "Ocultar codigo de invitacion" : "Tengo codigo de invitacion"}
          </button>

          {showOptionalCode ? (
            <div className="login-input-group" style={{ marginTop: "0.6rem", marginBottom: "0.85rem" }}>
              <input
                type="text"
                className="login-input login-input-noicon register-input-sm"
                placeholder="Codigo de invitacion (opcional)"
                value={codigoInvitacion}
                onChange={(event) => setCodigoInvitacion(event.target.value.toUpperCase())}
              />
            </div>
          ) : null}

          {localError ? <p className="login-error">{localError}</p> : null}
          {registerMutation.error ? <p className="login-error">{registerMutation.error.message}</p> : null}

          <button type="submit" className="login-btn-primary" style={{ marginTop: "0.75rem" }} disabled={registerMutation.isPending}>
            {registerMutation.isPending ? "Creando..." : "Crear cuenta"}
          </button>
        </form>

        <p className="login-footer">
          Ya tienes cuenta? <Link to="/login">Inicia sesion</Link>
        </p>
      </div>
    </section>
  );
}
