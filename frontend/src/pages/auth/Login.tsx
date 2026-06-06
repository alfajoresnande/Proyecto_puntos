import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useRetryAfterCooldown } from "../../lib/rateLimitError";
import { useAuthStore } from "../../store/authStore";

let initializedGoogleClientId: string | null = null;
let googleCredentialHandler: ((credential: string) => void) | null = null;
const LOGIN_SUCCESS_ROUTE = "/";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const hasRestoredSession = useAuthStore((state) => state.hasRestoredSession);
  const login = useAuthStore((state) => state.login);
  const loginWithGoogle = useAuthStore((state) => state.loginWithGoogle);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const { cooldownSeconds, cooldownMessage, startCooldownFromError } = useRetryAfterCooldown();

  const loginMutation = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: () => {
      navigate(LOGIN_SUCCESS_ROUTE, { replace: true });
    },
    onError: (error) => {
      startCooldownFromError(error);
    },
  });

  const googleMutation = useMutation({
    mutationFn: (credential: string) => loginWithGoogle(credential),
    onSuccess: () => {
      navigate(LOGIN_SUCCESS_ROUTE, { replace: true });
    },
    onError: (error) => {
      startCooldownFromError(error);
      setGoogleError(error.message);
    },
  });

  useEffect(() => {
    document.body.classList.add("auth-background");
    return () => {
      document.body.classList.remove("auth-background");
    };
  }, []);

  useEffect(() => {
    const state = (location.state as { loginNotice?: string; accessDeniedNotice?: string; from?: string } | null) ?? null;
    const nextNotice = state?.loginNotice?.trim() || state?.accessDeniedNotice?.trim() || "";
    if (!nextNotice) return;

    setLoginNotice(nextNotice);

    const nextState = { ...(state ?? {}) };
    delete nextState.loginNotice;
    delete nextState.accessDeniedNotice;

    navigate(location.pathname, {
      replace: true,
      state: Object.keys(nextState).length ? nextState : null,
    });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!googleClientId || user) return;

    let cancelled = false;
    googleCredentialHandler = (credential: string) => {
      setGoogleError(null);
      googleMutation.mutate(credential);
    };

    const renderGoogleButton = () => {
      if (cancelled || !window.google?.accounts.id || !googleButtonRef.current) return;

      if (initializedGoogleClientId !== googleClientId) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          ux_mode: "popup",
          callback: (response) => {
            if (!response.credential) {
              setGoogleError("No pudimos recibir la credencial de Google.");
              return;
            }
            googleCredentialHandler?.(response.credential);
          },
        });
        initializedGoogleClientId = googleClientId;
      }

      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: googleButtonRef.current.clientWidth || 360,
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );

    if (existingScript) {
      existingScript.addEventListener("load", renderGoogleButton);
      renderGoogleButton();
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", renderGoogleButton);
        if (googleCredentialHandler) googleCredentialHandler = null;
      };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    script.onerror = () => setGoogleError("No se pudo cargar Google. Intenta de nuevo en unos minutos.");
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.onload = null;
      script.onerror = null;
      if (googleCredentialHandler) googleCredentialHandler = null;
    };
  }, [googleClientId, googleMutation, user]);

  if (isRestoringSession || !hasRestoredSession) {
    return (
      <section className="login-page">
        <div className="session-loading" aria-live="polite">
          Verificando sesión...
        </div>
      </section>
    );
  }

  if (user) {
    return <Navigate to={LOGIN_SUCCESS_ROUTE} replace />;
  }

  return (
    <section className="login-page">
      {loginNotice ? (
        <div className="login-notice-overlay" onClick={() => setLoginNotice(null)}>
          <div
            className="login-notice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-notice-title"
            aria-describedby="login-notice-message"
            onClick={(event) => event.stopPropagation()}
          >
            <p id="login-notice-title" className="login-notice-title">
              Inicio de sesión requerido
            </p>
            <p id="login-notice-message" className="login-notice-message">
              {loginNotice}
            </p>
            <button type="button" className="login-notice-btn" onClick={() => setLoginNotice(null)}>
              Entendido
            </button>
          </div>
        </div>
      ) : null}
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="Nande" />
        </div>

        <h1 className="login-heading">Bienvenido</h1>
        <p className="login-subheading">Ingresa a tu cuenta</p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            loginMutation.mutate();
          }}
        >
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

          <label className="login-field-label">Contraseña</label>
          <div className="login-input-group">
            <span className="login-input-icon">*</span>
            <input
              type={showPassword ? "text" : "password"}
              className="login-input login-input-password"
              placeholder="********"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="login-input-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? "Ocultar" : "Ver"}
            </button>
          </div>

          {cooldownMessage ? <p className="login-error">{cooldownMessage}</p> : null}
          {!cooldownMessage && loginMutation.error ? <p className="login-error">{loginMutation.error.message}</p> : null}

          <button type="submit" className="login-btn-primary" disabled={loginMutation.isPending || cooldownSeconds > 0}>
            {loginMutation.isPending ? "Ingresando..." : cooldownSeconds > 0 ? "Espera para reintentar" : "Iniciar sesión"}
          </button>
        </form>

        <p className="login-footer login-footer-compact">
          <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        </p>

        <div className="login-divider">o continua con</div>

        {googleClientId ? (
          <div className="login-google-button-shell">
            <div ref={googleButtonRef} className="login-google-button" />
          </div>
        ) : (
          <button
            type="button"
            className="login-btn-google"
            onClick={() => setGoogleError("Falta configurar VITE_GOOGLE_CLIENT_ID en el frontend.")}
          >
            Continuar con Google
          </button>
        )}

        {googleMutation.isPending ? <p className="login-info">Conectando con Google...</p> : null}
        {googleError ? <p className="login-error">{googleError}</p> : null}

        <p className="login-footer">
          ¿No tienes una cuenta? <Link to="/registro">Regístrate aquí</Link>
        </p>
      </div>
    </section>
  );
}
