import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AuthTermsCheckbox } from "../../components/auth/AuthTermsCheckbox";
import { defaultRouteForRole } from "../../lib/auth";
import { useRetryAfterCooldown } from "../../lib/rateLimitError";
import { useAuthStore } from "../../store/authStore";

function passwordValidationErrors(value: string): string[] {
  const errors: string[] = [];
  if (value.length < 8) errors.push("Minimo 8 caracteres");
  if (!/[^A-Za-z0-9]/.test(value)) errors.push("Al menos 1 caracter especial");
  if (!/\d/.test(value)) errors.push("Al menos 1 numero");
  return errors;
}

export function Registro() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const register = useAuthStore((state) => state.register);
  const verifyEmail = useAuthStore((state) => state.verifyEmail);
  const resendEmailVerification = useAuthStore((state) => state.resendEmailVerification);

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [codigoInvitacion, setCodigoInvitacion] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [localError, setLocalError] = useState("");
  const [showOptionalCode, setShowOptionalCode] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationInfo, setVerificationInfo] = useState("");
  const {
    cooldownSeconds: registerCooldownSeconds,
    cooldownMessage: registerCooldownMessage,
    startCooldownFromError: startRegisterCooldown,
  } = useRetryAfterCooldown();
  const {
    cooldownSeconds: verifyCooldownSeconds,
    cooldownMessage: verifyCooldownMessage,
    startCooldownFromError: startVerifyCooldown,
  } = useRetryAfterCooldown();
  const {
    cooldownSeconds: resendCooldownSeconds,
    cooldownMessage: resendCooldownMessage,
    startCooldownFromError: startResendCooldown,
  } = useRetryAfterCooldown();

  const registerMutation = useMutation({
    mutationFn: () =>
      register({
        nombre: nombre.trim(),
        email: email.trim(),
        password,
        codigo_invitacion_usado: codigoInvitacion.trim() ? codigoInvitacion.trim().toUpperCase() : null,
        accepted_terms: true,
      }),
    onSuccess: (response) => {
      setPendingEmail(response.email);
      setVerificationCode("");
      setVerificationInfo(response.message || "Te enviamos un codigo para verificar tu correo.");
      setShowSuccessToast(true);
    },
    onError: (error) => {
      startRegisterCooldown(error);
      if (error.message.toLowerCase().includes("falta verificarlo")) {
        setPendingEmail(email.trim().toLowerCase());
        setVerificationCode("");
        setVerificationInfo("Ese correo ya estaba registrado. Podes ingresar el codigo o pedir uno nuevo.");
      }
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyEmail({ email: pendingEmail, code: verificationCode.trim() }),
    onSuccess: (session) => {
      setShowSuccessToast(true);
      navigate(defaultRouteForRole(session.user.rol));
    },
    onError: (error) => {
      startVerifyCooldown(error);
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => resendEmailVerification({ email: pendingEmail }),
    onSuccess: (response) => {
      setVerificationInfo(response.message || "Te enviamos un nuevo codigo.");
    },
    onError: (error) => {
      startResendCooldown(error);
    },
  });

  useEffect(() => {
    document.body.classList.add("auth-background");
    return () => {
      document.body.classList.remove("auth-background");
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
    if (passwordErrors.length > 0) {
      setLocalError(`Contraseña inválida: ${passwordErrors.join(", ")}.`);
      return;
    }
    if (password !== confirmPassword) {
      setLocalError("Las contraseñas no coinciden.");
      return;
    }
    if (!acceptedTerms) {
      setLocalError("Debes aceptar los Terminos y Condiciones.");
      return;
    }

    registerMutation.mutate();
  }

  function submitVerification(event: FormEvent) {
    event.preventDefault();
    setLocalError("");

    if (!/^\d{6}$/.test(verificationCode.trim())) {
      setLocalError("Ingresa el código de 6 dígitos que recibiste por correo.");
      return;
    }

    verifyMutation.mutate();
  }

  const isVerificationStep = Boolean(pendingEmail);

  return (
    <section className="login-page">
      {showSuccessToast ? <div className="auth-floating-toast">Cuenta creada. Revisa tu correo.</div> : null}
      <div className="login-card login-card-register-compact">
        <div className="login-logo" style={{ marginBottom: "0.75rem" }}>
          <img src="/logo.png" alt="Nande" style={{ height: "64px" }} />
        </div>

        <h1 className="login-heading" style={{ fontSize: "1.6rem", marginBottom: "0.2rem" }}>
          {isVerificationStep ? "Verificar correo" : "Crear cuenta"}
        </h1>
        <p className="login-subheading" style={{ marginBottom: "1.25rem" }}>
          {isVerificationStep
            ? `Ingresa el código que enviamos a ${pendingEmail}.`
            : "Regístrate y confirma tu correo para activar la cuenta."}
        </p>

        {isVerificationStep ? (
          <form onSubmit={submitVerification}>
            <label className="login-field-label">Código de verificación</label>
            <div className="login-input-group" style={{ marginBottom: "0.85rem" }}>
              <input
                type="text"
                inputMode="numeric"
                className="login-input login-input-noicon register-input-sm"
                placeholder="123456"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoComplete="one-time-code"
              />
            </div>

            {verificationInfo ? <p className="login-info">{verificationInfo}</p> : null}
            {localError ? <p className="login-error">{localError}</p> : null}
            {verifyCooldownMessage ? <p className="login-error">{verifyCooldownMessage}</p> : null}
            {!verifyCooldownMessage && verifyMutation.error ? <p className="login-error">{verifyMutation.error.message}</p> : null}
            {resendCooldownMessage ? <p className="login-error">{resendCooldownMessage}</p> : null}
            {!resendCooldownMessage && resendMutation.error ? <p className="login-error">{resendMutation.error.message}</p> : null}

            <button type="submit" className="login-btn-primary" disabled={verifyMutation.isPending || verifyCooldownSeconds > 0}>
              {verifyMutation.isPending ? "Verificando..." : verifyCooldownSeconds > 0 ? "Espera para reintentar" : "Verificar y entrar"}
            </button>

            <button
              type="button"
              className="register-optional-btn"
              style={{ marginTop: "0.85rem" }}
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending || resendCooldownSeconds > 0}
            >
              {resendMutation.isPending ? "Enviando..." : resendCooldownSeconds > 0 ? "Espera para reenviar" : "Reenviar código"}
            </button>
          </form>
        ) : (
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

          <label className="login-field-label">Correo electrónico</label>
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

          <label className="login-field-label">Contraseña</label>
          <div className="login-input-group" style={{ marginBottom: "0.35rem" }}>
            <input
              type={showPassword ? "text" : "password"}
              className="login-input login-input-noicon register-input-sm login-input-password"
              placeholder="Ingresa tu contraseña"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="button" className="login-input-toggle" onClick={() => setShowPassword((prev) => !prev)}>
              {showPassword ? "Ocultar" : "Ver"}
            </button>
          </div>
          <p className="register-pass-hint">Mínimo 8 caracteres, con al menos 1 carácter especial y 1 número.</p>

          <label className="login-field-label">Confirmar contraseña</label>
          <div className="login-input-group" style={{ marginBottom: "0.85rem" }}>
            <input
              type={showConfirmPassword ? "text" : "password"}
              className="login-input login-input-noicon register-input-sm login-input-password"
              placeholder="Repite tu contraseña"
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
            {showOptionalCode ? "Ocultar código de invitación" : "Tengo código de invitación"}
          </button>

          {showOptionalCode ? (
            <div className="login-input-group" style={{ marginTop: "0.6rem", marginBottom: "0.85rem" }}>
              <input
                type="text"
                className="login-input login-input-noicon register-input-sm"
                placeholder="Código de invitación (opcional)"
                value={codigoInvitacion}
                onChange={(event) => setCodigoInvitacion(event.target.value.toUpperCase())}
              />
            </div>
          ) : null}

          {localError ? <p className="login-error">{localError}</p> : null}
          {registerCooldownMessage ? <p className="login-error">{registerCooldownMessage}</p> : null}
          {!registerCooldownMessage && registerMutation.error ? <p className="login-error">{registerMutation.error.message}</p> : null}

          <AuthTermsCheckbox
            checked={acceptedTerms}
            onChange={(checked) => {
              setAcceptedTerms(checked);
              if (checked && localError === "Debes aceptar los Terminos y Condiciones.") {
                setLocalError("");
              }
            }}
            disabled={registerMutation.isPending}
          />

          <button
            type="submit"
            className="login-btn-primary"
            style={{ marginTop: "0.75rem" }}
            disabled={registerMutation.isPending || registerCooldownSeconds > 0}
          >
            {registerMutation.isPending ? "Creando..." : registerCooldownSeconds > 0 ? "Espera para reintentar" : "Crear cuenta"}
          </button>
        </form>
        )}

        <p className="login-footer">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </div>
    </section>
  );
}
