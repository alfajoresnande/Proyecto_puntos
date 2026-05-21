type CatalogPaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  itemLabel?: string;
  onPageChange: (page: number) => void;
};

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

  return (
    <nav className="catalog-pagination" aria-label="Paginacion del catalogo">
      <p className="catalog-pagination-summary">
        Mostrando {from}-{to} de {totalItems} {itemLabel}
      </p>
      <div className="catalog-pagination-controls">
        <button
          type="button"
          className="catalog-page-btn"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Anterior
        </button>
        <span className="catalog-page-label">
          Pagina {safePage} de {safeTotalPages}
        </span>
        <button
          type="button"
          className="catalog-page-btn"
          disabled={safePage >= safeTotalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
