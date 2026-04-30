import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { defaultRouteForRole } from "../../lib/auth";
import { useAuthStore } from "../../store/authStore";

export function Login() {
  const navigate = useNavigate();
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

  const loginMutation = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: (session) => {
      navigate(defaultRouteForRole(session.user.rol));
    },
  });

  const googleMutation = useMutation({
    mutationFn: (credential: string) => loginWithGoogle(credential),
    onSuccess: (session) => {
      navigate(defaultRouteForRole(session.user.rol));
    },
    onError: (error) => {
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
    if (!googleClientId || user) return;

    let cancelled = false;

    const renderGoogleButton = () => {
      if (cancelled || !window.google?.accounts.id || !googleButtonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        ux_mode: "popup",
        callback: (response) => {
          if (!response.credential) {
            setGoogleError("No pudimos recibir la credencial de Google.");
            return;
          }
          setGoogleError(null);
          googleMutation.mutate(response.credential);
        },
      });

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
    };
  }, [googleClientId, user]);

  if (isRestoringSession || !hasRestoredSession) {
    return (
      <section className="login-page">
        <div className="session-loading" aria-live="polite">
          Verificando sesion...
        </div>
      </section>
    );
  }

  if (user) {
    return <Navigate to={defaultRouteForRole(user.rol)} replace />;
  }

  return (
    <section className="login-page">
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

          <label className="login-field-label">Contrasena</label>
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

          {loginMutation.error ? <p className="login-error">{loginMutation.error.message}</p> : null}

          <button type="submit" className="login-btn-primary" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Ingresando..." : "Iniciar Sesion"}
          </button>
        </form>

        <p className="login-footer login-footer-compact">
          <Link to="/forgot-password">Olvidaste tu contrasena?</Link>
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
          No tienes una cuenta? <Link to="/registro">Registrate aqui</Link>
        </p>
      </div>
    </section>
  );
}

