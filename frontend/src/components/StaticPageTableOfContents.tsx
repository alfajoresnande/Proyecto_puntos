import type { StaticPageHeading } from "../lib/pageContent";

type StaticPageTableOfContentsProps = {
  headings: StaticPageHeading[];
  title?: string;
};

export function StaticPageTableOfContents({
  headings,
  title = "Indice",
}: StaticPageTableOfContentsProps) {
  if (!headings.length) return null;

  return (
    <nav className="pagina-indice" aria-label={`${title} del documento`}>
      <h2 className="pagina-indice-title">{title}</h2>
      <ul className="pagina-indice-list">
        {headings.map((heading) => (
          <li
            key={heading.id}
            className={`pagina-indice-item pagina-indice-depth-${Math.min(Math.max(heading.depth, 2), 6)}`}
          >
            <a className="pagina-indice-link" href={`#${encodeURIComponent(heading.id)}`}>
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
