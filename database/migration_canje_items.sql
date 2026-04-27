-- ============================================================
-- MIGRACION: detalle de canjes (carrito)
-- Crea tabla canje_items y backfill de canjes existentes.
-- ============================================================

CREATE TABLE IF NOT EXISTS canje_items (
    id                  INT             PRIMARY KEY AUTO_INCREMENT,
    canje_id            INT             NOT NULL,
    producto_id         INT             NOT NULL,
    cantidad            INT             NOT NULL DEFAULT 1,
    puntos_unitarios    INT             NOT NULL,
    puntos_total        INT             NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_canje_items_canje
        FOREIGN KEY (canje_id) REFERENCES canjes(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_canje_items_producto
        FOREIGN KEY (producto_id) REFERENCES productos(id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_canje_items_producto
        UNIQUE (canje_id, producto_id)
);

INSERT INTO canje_items (canje_id, producto_id, cantidad, puntos_unitarios, puntos_total)
SELECT c.id,
       c.producto_id,
       1,
       COALESCE(NULLIF(p.puntos_requeridos, 0), c.puntos_usados),
       c.puntos_usados
FROM canjes c
LEFT JOIN productos p ON p.id = c.producto_id
LEFT JOIN canje_items ci ON ci.canje_id = c.id
WHERE ci.id IS NULL;
