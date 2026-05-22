import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { mediaUrl } from "../../lib/apiBase";
import { useAuthStore } from "../../store/authStore";
import type { Producto } from "../../types";

type TimelineEntry = {
  year: string;
  title: string;
  text: string;
  detail: string;
  image: string;
};

type LocationImage = {
  src: string;
  alt: string;
};

type MapPoint = {
  id: string;
  name: string;
  city: string;
  address: string;
  contact: string;
  mapsUrl: string;
};

function productImage(producto: Producto): string {
  const image = producto.imagenes?.find(Boolean) || producto.imagen_url;
  return image ? mediaUrl(image) : "/logo.png";
}

function hasProductImage(producto: Producto): boolean {
  const image = producto.imagenes?.find(Boolean) || producto.imagen_url || "";
  return Boolean(image && !image.endsWith("/logo.png") && image !== "logo.png");
}

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number.isFinite(n) ? n : 0);
}

function rewardPoints(producto: Producto): number {
  const value = Number(producto.puntaje_al_comprar ?? producto.puntos_acumulables ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function Home() {
  const user = useAuthStore((state) => state.user);
  const cvFileInputRef = useRef<HTMLInputElement | null>(null);
  const shouldShowCvSection = !user || user.rol === "cliente";
  const [cvForm, setCvForm] = useState({
    nombre: "",
    email: "",
    telefono: "",
    mensaje: "",
  });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvStatus, setCvStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [cvSending, setCvSending] = useState(false);
  const mapPoints: MapPoint[] = [
    {
      id: "la-unidad",
      name: "Ñandé - Mercado de Sabores",
      city: "Corrientes, Corrientes",
      address: "Padre Borgatti 1474-1600, La Unidad, Mercado de Sabores, puesto 3",
      contact: "+54 379 463-2610",
      mapsUrl: "https://maps.app.goo.gl/wo9r1LGXSsh4Bmht7",
    },
  ];
  const selectedMapPoint = mapPoints[0];
  const mapEmbedUrl = "https://www.openstreetmap.org/export/embed.html?bbox=-58.8588%2C-27.4788%2C-58.8422%2C-27.4676&layer=mapnik&marker=-27.47298%2C-58.85053";

  useEffect(() => {
    document.body.classList.add("home-background");
    return () => {
      document.body.classList.remove("home-background");
    };
  }, []);

  function handleCvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setCvFile(file);
    setCvStatus(null);
  }

  async function handleCvSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCvStatus(null);

    if (!cvFile) {
      setCvStatus({ type: "error", text: "Adjunta tu CV en PDF, DOC o DOCX." });
      return;
    }

    const formData = new FormData();
    formData.append("nombre", cvForm.nombre);
    formData.append("email", cvForm.email);
    formData.append("telefono", cvForm.telefono);
    formData.append("mensaje", cvForm.mensaje);
    formData.append("cv", cvFile);

    try {
      setCvSending(true);
      await api.post<{ ok: boolean; id: number }>("/postulaciones", formData);
      setCvForm({ nombre: "", email: "", telefono: "", mensaje: "" });
      setCvFile(null);
      if (cvFileInputRef.current) cvFileInputRef.current.value = "";
      setCvStatus({ type: "ok", text: "Recibimos tu postulacion. Gracias por acercarte a Nande." });
    } catch (err) {
      setCvStatus({ type: "error", text: err instanceof Error ? err.message : "No pudimos enviar la postulacion." });
    } finally {
      setCvSending(false);
    }
  }

  const productosDestacadosQuery = useQuery({
    queryKey: ["home", "productos", "destacados"],
    queryFn: () => api.get<Producto[]>("/productos/destacados?limit=12"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const productosDestacados = useMemo(() => {
    const productos = productosDestacadosQuery.data ?? [];
    return productos.filter(hasProductImage);
  }, [productosDestacadosQuery.data]);

  const productosDestacadosCarousel = useMemo(() => {
    return productosDestacados.length > 1 ? [...productosDestacados, ...productosDestacados] : productosDestacados;
  }, [productosDestacados]);

  const heroImage = "/hero.webp";
  const locationGallery: LocationImage[] = [
    { src: "/mercado-sabores-frente.jpg", alt: "Frente de Mercado de Sabores en La Unidad" },
    { src: "/nande-la-unidad-puesto.jpg", alt: "Puesto de Ñandé dentro de La Unidad" },
    { src: "/nande-la-unidad-productos.jpg", alt: "Productos de Ñandé en Mercado de Sabores" },
  ];

  const timelineEntries: TimelineEntry[] = [
    {
      year: "2025",
      title: "Representación regional en La Rural Palermo",
      text: "Ñandé participó como representante regional de Corrientes dentro del universo de alfajores en Buenos Aires.",
      detail: "",
      image: "/rural-palermo.webp",
    },
    {
      year: "Confederación Argentina de la Mediana Empresa",
      title: "Representando a Corrientes en alfajores",
      text: "Ñandé participó en CAME, la Confederación Argentina de la Mediana Empresa, representando a Corrientes dentro del universo de los alfajores.",
      detail: "Un espacio para mostrar identidad regional, producto y presencia correntina frente a referentes de todo el país.",
      image: "/came.webp",
    },
    {
      year: "Ferias",
      title: "Fiesta Nacional del Alfajor en La Falda",
      text: "Ñandé participó en La Falda, Córdoba, dentro de la Fiesta Nacional del Alfajor, llevando la identidad correntina al encuentro.",
      detail: "Un espacio para compartir producto, historia y presencia regional junto a referentes alfajoreros de todo el país.",
      image: "/lafalta.webp",
    },
  ];

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".home-timeline-card"));
    if (!items.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.22, rootMargin: "0px 0px -8% 0px" },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="home-page">
      <section className="home-hero" aria-label="Imagen principal de Ñandé">
        <img src={heroImage} alt="Imagen principal de Ñandé Alfajores Correntinos" className="home-hero-image" />
      </section>

      <div className="home-content-shell">
        <section className="home-location-section home-section home-section-location">
          <div className="home-location-head">
            <span className="home-kicker">Dónde encontrarnos</span>
          </div>

          {locationGallery.map((image, index) => (
            <figure key={image.src} className={`home-location-photo home-location-photo-${index + 1}`}>
              <img
                src={image.src}
                alt={image.alt}
                onError={(event) => {
                  event.currentTarget.src = "/logo.png";
                  event.currentTarget.classList.add("is-placeholder");
                }}
              />
            </figure>
          ))}

          <p className="home-location-text">
            Nuestro espacio principal hoy está en La Unidad, un punto ideal para descubrir productos, encontrarnos con la gente y vivir de cerca el sabor de Ñandé.
          </p>
        </section>

        <section className="home-map-section home-section home-section-map">
          <div className="home-map-shell">
            <div className="home-map-card">
              <div className="home-map-frame">
                <iframe
                  title="Mapa de puntos Ñandé"
                  src={mapEmbedUrl}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
              <p>La vista muestra Mercado de Sabores dentro de La Unidad.</p>
              <p>Base cartográfica: OpenStreetMap.</p>
            </div>

            <aside className="home-map-detail" aria-live="polite">
              <span className="home-map-kicker">Punto seleccionado</span>
              <h2>{selectedMapPoint.name}</h2>
              <p>{selectedMapPoint.city}</p>

              <div className="home-map-info">
                <span>Dirección</span>
                <strong>{selectedMapPoint.address}</strong>
              </div>

              <div className="home-map-info">
                <span>Contacto</span>
                <strong>{selectedMapPoint.contact}</strong>
              </div>

              <a className="home-map-link" href={selectedMapPoint.mapsUrl} target="_blank" rel="noreferrer">
                Ver en Google Maps
              </a>
            </aside>
          </div>
        </section>

        <section id="como-funciona" className="home-flow-section home-section home-section-flow">
          <div className="home-section-head home-flow-head">
            <span className="home-kicker home-kicker-accent">Para vos</span>
            <h2>Comprá, acumulá puntos y volvé cuando quieras</h2>
            <p>Te dejamos una guía simple para que entiendas rápido cómo comprar y cómo usar tus puntos dentro de Ñandé.</p>
          </div>

          <div className="home-flow-steps">
            <div className="home-flow-step">
              <article className="home-flow-card">
                <span className="home-flow-number">01</span>
                <p>Comprás desde la tienda, elegís tus productos y acumulás puntos con cada compra.</p>
              </article>
              <article className="home-flow-detail-card">
                <h3>¿Cómo comprás?</h3>
                <p>Entrás a la tienda online, elegís los productos que querés, confirmás tu pedido para retiro en sucursal y con cada compra acumulás puntos para canjearlos más adelante por otros productos.</p>
                <Link to="/tienda" className="home-flow-action">Comprar</Link>
              </article>
            </div>
            <div className="home-flow-step">
              <article className="home-flow-card">
                <span className="home-flow-number">02</span>
                <p>Canjeás tus puntos por productos y los retirás en la sucursal que selecciones.</p>
              </article>
              <article className="home-flow-detail-card">
                <h3>¿Cómo canjeás?</h3>
                <p>Entrás al catálogo de canjes, elegís el producto que querés usar con tus puntos, lo reservás desde tu cuenta y después lo retirás en la sucursal seleccionada.</p>
                <Link to="/catalogo" className="home-flow-action">Canjear</Link>
              </article>
            </div>
          </div>
        </section>

        {productosDestacados.length ? (
          <section id="productos-destacados" className="home-section home-section-products">
            <div className="home-section-head">
              <span className="home-kicker">Productos destacados</span>
            </div>

            <div className="home-products-carousel" aria-label="Productos destacados">
              <div className={`home-products-grid${productosDestacados.length > 1 ? " is-animated" : ""}`}>
                {productosDestacadosCarousel.map((producto, index) => {
                  const isDuplicate = index >= productosDestacados.length;
                  const duplicateTabIndex = isDuplicate ? -1 : undefined;

                  return (
                    <article key={`${producto.id}-${index}`} className="home-product-card" aria-hidden={isDuplicate || undefined}>
                  <div className="home-product-media">
                    <img src={productImage(producto)} alt={producto.nombre} className="home-product-image" />
                    <span className="home-product-category">{producto.categoria || "Ñandé"}</span>
                  </div>
                  <div className="home-product-body">
                    <h3>{producto.nombre}</h3>
                    <p>{producto.descripcion || "Producto disponible para comprar online."}</p>
                    <div className="home-product-meta home-product-meta-static">
                      <div className="home-product-price-row">
                        <span>Precio</span>
                        <strong>{money(producto.precio_dinero)}</strong>
                      </div>
                      {rewardPoints(producto) > 0 ? (
                        <span className="home-product-earned-points">Sumás {rewardPoints(producto)} puntos con este producto</span>
                      ) : null}
                    </div>
                    <div className="home-product-actions">
                      <Link
                        to={`/tienda?producto=${producto.id}`}
                        className="home-product-action home-product-action-secondary"
                        tabIndex={duplicateTabIndex}
                      >
                        Ver producto
                      </Link>
                      <Link
                        to={user ? `/tienda?producto=${producto.id}` : "/login"}
                        className="home-product-action home-product-action-primary"
                        tabIndex={duplicateTabIndex}
                      >
                        Agregar al carrito de compras
                      </Link>
                    </div>
                  </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        <section className="home-section home-timeline-section home-section-timeline">
          <div className="home-section-head">
            <span className="home-kicker">Competencias, ferias y presencia</span>
            <h2>Un recorrido visual para contar cómo Ñandé representa su identidad</h2>
            <p>Momentos que definen nuestra historia y nuestra presencia regional.</p>
          </div>

          <div className="home-timeline">
            <div className="home-timeline-line" aria-hidden="true" />
            {timelineEntries.map((entry, index) => (
              <div key={`${entry.year}-${entry.title}`} className={`home-timeline-row${index % 2 === 1 ? " is-right" : " is-left"}`}>
                <article className="home-timeline-card">
                  <div className="home-timeline-media">
                    <img src={entry.image} alt={entry.title} />
                  </div>
                  <div className="home-timeline-copy">
                    <span className="home-timeline-year">{entry.year}</span>
                    <h3>{entry.title}</h3>
                    <p>{entry.text}</p>
                    {entry.detail ? <p>{entry.detail}</p> : null}
                  </div>
                </article>
                <span className="home-timeline-dot" aria-hidden="true" />
              </div>
            ))}
          </div>
        </section>

        {shouldShowCvSection ? (
          <section id="trabaja-con-nosotros" className="home-section home-section-cv">
            <div className="home-cv-shell">
              <div className="home-cv-copy">
                <span className="home-kicker home-kicker-accent">Trabaja con nosotros</span>
                <h2>Dejanos tu CV</h2>
                <p>Si queres sumarte al equipo, podes enviar tus datos y un archivo en PDF, DOC o DOCX. Lo vamos a revisar desde el panel interno.</p>
              </div>

              <form className="home-cv-form" onSubmit={handleCvSubmit}>
                <label className="home-cv-file">
                  <span>{cvFile ? cvFile.name : "Sin archivo seleccionado"}</span>
                  <strong>Seleccionar archivo</strong>
                  <input
                    ref={cvFileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleCvFileChange}
                  />
                </label>

                <div className="home-cv-grid">
                  <label>
                    <span>Nombre y apellido*</span>
                    <input
                      required
                      value={cvForm.nombre}
                      onChange={(event) => setCvForm((prev) => ({ ...prev, nombre: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>E-mail*</span>
                    <input
                      required
                      type="email"
                      value={cvForm.email}
                      onChange={(event) => setCvForm((prev) => ({ ...prev, email: event.target.value }))}
                    />
                  </label>
                </div>

                <label>
                  <span>Telefono</span>
                  <input
                    value={cvForm.telefono}
                    onChange={(event) => setCvForm((prev) => ({ ...prev, telefono: event.target.value }))}
                  />
                </label>

                <label>
                  <span>Mensaje o comentario*</span>
                  <textarea
                    required
                    rows={4}
                    value={cvForm.mensaje}
                    onChange={(event) => setCvForm((prev) => ({ ...prev, mensaje: event.target.value }))}
                  />
                </label>

                <div className="home-cv-actions">
                  <button type="submit" disabled={cvSending}>{cvSending ? "Enviando..." : "Enviar"}</button>
                  {cvStatus ? <p className={`home-cv-status ${cvStatus.type}`}>{cvStatus.text}</p> : null}
                </div>
              </form>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
