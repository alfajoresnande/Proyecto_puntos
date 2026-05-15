import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
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
  return producto.imagenes?.find(Boolean) || producto.imagen_url || "/logo.png";
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
  const value = Number(producto.puntos_requeridos ?? producto.precio_puntos ?? producto.puntos_para_canjear ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function Home() {
  const user = useAuthStore((state) => state.user);
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

  const productosVentaQuery = useQuery({
    queryKey: ["home", "productos", "venta"],
    queryFn: () => api.get<Producto[]>("/productos?modo=venta"),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const productosDestacados = useMemo(() => {
    const productos = productosVentaQuery.data ?? [];
    const conImagen = productos.filter(hasProductImage);
    const destacados = conImagen.filter((producto) => producto.destacado_home);
    return destacados.slice(0, 4);
  }, [productosVentaQuery.data]);

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

            <div className="home-products-grid">
              {productosDestacados.map((producto) => (
                <article key={producto.id} className="home-product-card">
                  <div className="home-product-media">
                    <img src={productImage(producto)} alt={producto.nombre} className="home-product-image" />
                  </div>
                  <div className="home-product-body">
                    <span className="home-product-category">{producto.categoria || "Ñandé"}</span>
                    <h3>{producto.nombre}</h3>
                    {producto.descripcion ? <p>{producto.descripcion}</p> : null}
                    <div className="home-product-meta home-product-meta-static">
                      <strong>{money(producto.precio_dinero)}</strong>
                      <span>{rewardPoints(producto) > 0 ? `+${rewardPoints(producto)} pts` : "Comprar"}</span>
                    </div>
                    <div className="home-product-actions">
                      <Link to={`/tienda?producto=${producto.id}`} className="home-product-action home-product-action-secondary">Ver producto</Link>
                      <Link to={user ? `/tienda?producto=${producto.id}` : "/login"} className="home-product-action home-product-action-primary">Comprar</Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="home-section home-timeline-section home-section-timeline">
          <div className="home-section-head">
            <span className="home-kicker">Competencias, ferias y presencia</span>
            <h2>Un recorrido visual para contar cómo Ñandé representa su identidad</h2>
            <p>La idea es que mientras bajás, las historias y fotos aparezcan con ritmo, casi como una línea de tiempo viva.</p>
          </div>

          <div className="home-timeline">
            <div className="home-timeline-line" aria-hidden="true" />
            {timelineEntries.map((entry, index) => (
              <article key={`${entry.year}-${entry.title}`} className={`home-timeline-card${index % 2 === 1 ? " is-right" : " is-left"}`}>
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
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
