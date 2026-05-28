import { useEffect } from "react";

const TERMS_PDF_PATH = "/terminos-y-condiciones-nande.pdf";

export function Terminos() {
  useEffect(() => {
    document.body.classList.add("catalogo-background");
    return () => {
      document.body.classList.remove("catalogo-background");
    };
  }, []);

  return (
    <section className="pagina-page">
      <div className="pagina-card">
        <div>
          <h1 className="pagina-title">Terminos y Condiciones</h1>
          <p className="pagina-content">
            Consulta el documento oficial directamente desde el navegador o descargalo en PDF.
          </p>

          <div className="pagina-pdf-actions">
            <a
              className="catalog-float-toast-btn-primary pagina-pdf-btn"
              href={TERMS_PDF_PATH}
              target="_blank"
              rel="noreferrer"
            >
              Abrir PDF
            </a>
            <a className="catalog-float-toast-btn-secondary pagina-pdf-btn" href={TERMS_PDF_PATH} download>
              Descargar PDF
            </a>
          </div>

          <div className="pagina-pdf-viewer">
            <object className="pagina-pdf-frame" data={TERMS_PDF_PATH} type="application/pdf">
              <p className="pagina-content">
                Tu navegador no pudo mostrar el PDF. Puedes abrirlo desde{" "}
                <a href={TERMS_PDF_PATH} target="_blank" rel="noreferrer">
                  este enlace
                </a>
                .
              </p>
            </object>
          </div>
        </div>
      </div>
    </section>
  );
}
