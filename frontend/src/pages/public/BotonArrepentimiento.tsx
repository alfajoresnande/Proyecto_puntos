import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api";
import {
  COMPANY_ADDRESS_LINES,
  COMPANY_EMAIL,
  COMPANY_PHONE_DISPLAY,
  INSTAGRAM_HANDLE,
  INSTAGRAM_PROFILE_URL,
  WHATSAPP_COMPANY_URL,
} from "../../lib/contact";

type ArrepentimientoPayload = {
  numero_orden: string;
  nombre_apellido: string;
  email: string;
  telefono: string;
  mensaje: string;
};

type ArrepentimientoResponse = {
  ok: true;
  codigo_tramite: string;
};

const INITIAL_FORM: ArrepentimientoPayload = {
  numero_orden: "",
  nombre_apellido: "",
  email: "",
  telefono: "",
  mensaje: "",
};

function ContactIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="arrepentimiento-contact-icon">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BotonArrepentimiento() {
  const [form, setForm] = useState<ArrepentimientoPayload>(INITIAL_FORM);
  const [errorMessage, setErrorMessage] = useState("");
  const [successCode, setSuccessCode] = useState("");

  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  const submitMutation = useMutation({
    mutationFn: (payload: ArrepentimientoPayload) => api.post<ArrepentimientoResponse>("/arrepentimiento", payload),
    onSuccess: (response) => {
      setSuccessCode(response.codigo_tramite);
      setErrorMessage("");
      setForm(INITIAL_FORM);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (error) => {
      setSuccessCode("");
      setErrorMessage(error instanceof Error ? error.message : "No pudimos enviar la solicitud.");
    },
  });

  function updateField(field: keyof ArrepentimientoPayload, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessCode("");
    submitMutation.mutate({
      numero_orden: form.numero_orden.trim(),
      nombre_apellido: form.nombre_apellido.trim(),
      email: form.email.trim(),
      telefono: form.telefono.trim(),
      mensaje: form.mensaje.trim(),
    });
  }

  return (
    <section className="pagina-page">
      <div className="pagina-card arrepentimiento-card">
        <div className="arrepentimiento-grid">
          <aside className="arrepentimiento-contact-panel">
            <p className="arrepentimiento-eyebrow">Contacto</p>
            <h1 className="pagina-title arrepentimiento-title">Boton de arrepentimiento</h1>

            <div className="arrepentimiento-contact-list">
              <a href={INSTAGRAM_PROFILE_URL} target="_blank" rel="noreferrer" className="arrepentimiento-contact-item">
                <ContactIcon path="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z M16.5 7.5h.01 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
                <span>{INSTAGRAM_HANDLE}</span>
              </a>
              <a href={`mailto:${COMPANY_EMAIL}`} className="arrepentimiento-contact-item">
                <ContactIcon path="M4 6h16v12H4z M4 7l8 6 8-6" />
                <span>{COMPANY_EMAIL}</span>
              </a>
              <a href={WHATSAPP_COMPANY_URL} target="_blank" rel="noreferrer" className="arrepentimiento-contact-item">
                <ContactIcon path="M20 11.5A8.5 8.5 0 1 1 6 5l-1.5 4L8.5 8A8.5 8.5 0 0 1 20 11.5Z M9 9.5c.5 2 2 3.5 4 4l1.2-1.2c.2-.2.5-.3.8-.2l2 .7c.4.1.6.5.6.9V17c0 .6-.4 1-1 1A12 12 0 0 1 6 7c0-.6.4-1 1-1h3.3c.4 0 .8.3.9.6l.7 2c.1.3 0 .6-.2.8L9 9.5Z" />
                <span>{COMPANY_PHONE_DISPLAY}</span>
              </a>
              <div className="arrepentimiento-contact-item arrepentimiento-contact-item-static">
                <ContactIcon path="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z M12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />
                <span>{COMPANY_ADDRESS_LINES.join(" ")}</span>
              </div>
            </div>

            <div className="arrepentimiento-legal-note">
              <p className="arrepentimiento-legal-title">Aviso legal</p>
              <p>
                Segun la <strong>Disposicion 954/2025</strong>, el derecho de arrepentimiento para compras a distancia
                puede ejercerse dentro de los <strong>10 dias corridos</strong>. No aplica, entre otros casos, cuando
                el producto ya fue utilizado o consumido, cuando se trata de bienes perecederos o cuando la compra fue
                realizada para reventa o procesos productivos.
              </p>
            </div>
          </aside>

          <div className="arrepentimiento-form-panel">
            <p className="arrepentimiento-lead arrepentimiento-form-lead">
              Si te arrepentiste de una compra, puedes pedir la cancelacion enviando este formulario con tu numero de
              pedido. Tienes un maximo de 10 dias corridos desde que recibiste el producto.
            </p>

            {successCode ? (
              <div className="arrepentimiento-confirmation" role="status">
                <h2>Solicitud enviada</h2>
                <p>
                  Recibimos tu pedido. Tu codigo de tramite es <strong>{successCode}</strong>.
                </p>
                <p>Guardalo para futuras consultas con el equipo.</p>
              </div>
            ) : null}

            <form className="arrepentimiento-form" onSubmit={handleSubmit}>
              <label className="arrepentimiento-field">
                <span>Numero de pedido</span>
                <input
                  value={form.numero_orden}
                  onChange={(event) => updateField("numero_orden", event.target.value)}
                  placeholder="Ej: PED-1024"
                  autoComplete="off"
                />
              </label>

              <label className="arrepentimiento-field">
                <span>Nombre y apellido</span>
                <input
                  value={form.nombre_apellido}
                  onChange={(event) => updateField("nombre_apellido", event.target.value)}
                  autoComplete="name"
                />
              </label>

              <label className="arrepentimiento-field">
                <span>Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  autoComplete="email"
                />
              </label>

              <label className="arrepentimiento-field">
                <span>Telefono</span>
                <input
                  value={form.telefono}
                  onChange={(event) => updateField("telefono", event.target.value)}
                  autoComplete="tel"
                />
              </label>

              <label className="arrepentimiento-field">
                <span>Mensaje</span>
                <textarea
                  value={form.mensaje}
                  onChange={(event) => updateField("mensaje", event.target.value)}
                  rows={8}
                />
              </label>

              {errorMessage ? <p className="arrepentimiento-feedback is-error">{errorMessage}</p> : null}

              <button type="submit" className="catalog-float-toast-btn-primary arrepentimiento-submit" disabled={submitMutation.isPending}>
                {submitMutation.isPending ? "Enviando..." : "Enviar solicitud"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
