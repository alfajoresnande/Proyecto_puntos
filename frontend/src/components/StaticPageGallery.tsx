import { MAX_STATIC_PAGE_IMAGES } from "../lib/pageContent";

type StaticPageGalleryProps = {
  images: string[];
  className?: string;
};

export function StaticPageGallery({ images, className }: StaticPageGalleryProps) {
  const safeImages = images
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, MAX_STATIC_PAGE_IMAGES);

  if (!safeImages.length) return null;

  const classes = ["pagina-gallery", `pagina-gallery-count-${safeImages.length}`];
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      {safeImages.map((url, index) => (
        <div className="pagina-gallery-item" key={`${url}-${index}`}>
          <img src={url} alt={`Foto ${index + 1}`} className="pagina-gallery-img" loading="lazy" />
        </div>
      ))}
    </div>
  );
}
