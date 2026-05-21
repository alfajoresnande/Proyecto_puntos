type CatalogPaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  itemLabel?: string;
  onPageChange: (page: number) => void;
};

function buildPaginationItems(page: number, totalPages: number): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const safePages = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const items: Array<number | "ellipsis-left" | "ellipsis-right"> = [];

  for (let index = 0; index < safePages.length; index += 1) {
    const current = safePages[index];
    const previous = safePages[index - 1];
    if (previous) {
      const gap = current - previous;
      if (gap === 2) {
        items.push(previous + 1);
      } else if (gap > 2) {
        items.push(previous < page ? "ellipsis-left" : "ellipsis-right");
      }
    }
    items.push(current);
  }

  return items;
}

export function CatalogPagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  itemLabel = "productos",
  onPageChange,
}: CatalogPaginationProps) {
  if (totalItems <= pageSize || totalPages <= 1) return null;

  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const from = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(totalItems, safePage * pageSize);
  const items = buildPaginationItems(safePage, safeTotalPages);

  return (
    <nav className="catalog-pagination" aria-label="Paginacion del catalogo">
      <div className="catalog-pagination-meta">
        <p className="catalog-pagination-summary">
          Mostrando {from}-{to} de {totalItems} {itemLabel}
        </p>
        <span className="catalog-pagination-page-size">{pageSize} por pagina</span>
      </div>
      <div className="catalog-pagination-controls">
        <button
          type="button"
          className="catalog-page-btn"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Pagina anterior"
        >
          &lsaquo;
        </button>
        <div className="catalog-page-numbers" aria-label="Paginas disponibles">
          {items.map((item, index) =>
            typeof item === "number" ? (
              <button
                key={item}
                type="button"
                className={`catalog-page-btn catalog-page-number${item === safePage ? " is-active" : ""}`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? "page" : undefined}
                aria-label={`Ir a la pagina ${item}`}
              >
                {item}
              </button>
            ) : (
              <span key={`${item}-${index}`} className="catalog-page-ellipsis" aria-hidden="true">
                ...
              </span>
            ),
          )}
        </div>
        <span className="catalog-page-label">
          Pagina {safePage} de {safeTotalPages}
        </span>
        <button
          type="button"
          className="catalog-page-btn"
          disabled={safePage >= safeTotalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Pagina siguiente"
        >
          &rsaquo;
        </button>
      </div>
    </nav>
  );
}
