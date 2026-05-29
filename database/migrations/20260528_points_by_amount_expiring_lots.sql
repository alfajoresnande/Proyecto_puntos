-- Redisenio de puntos: regla por monto y vencimiento por lote.

ALTER TABLE movimientos_puntos
  MODIFY COLUMN tipo ENUM(
    'asignacion_manual',
    'codigo_canje',
    'referido_invitador',
    'referido_invitado',
    'canje_producto',
    'devolucion_canje',
    'acreditacion_compra',
    'vencimiento_puntos',
    'ajuste'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS puntos_lotes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  movimiento_id INT NULL,
  puntos_originales INT NOT NULL,
  puntos_disponibles INT NOT NULL,
  expires_at DATETIME NOT NULL,
  origen_tipo VARCHAR(50) NULL,
  origen_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_puntos_lotes_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_puntos_lotes_movimiento
    FOREIGN KEY (movimiento_id) REFERENCES movimientos_puntos(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_puntos_lotes_movimiento (movimiento_id),
  INDEX idx_puntos_lotes_usuario_vencimiento (usuario_id, expires_at, puntos_disponibles),
  INDEX idx_puntos_lotes_origen (origen_tipo, origen_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS puntos_lote_consumos (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  lote_id BIGINT UNSIGNED NOT NULL,
  movimiento_id INT NOT NULL,
  puntos INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_puntos_consumos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_puntos_consumos_lote
    FOREIGN KEY (lote_id) REFERENCES puntos_lotes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_puntos_consumos_movimiento
    FOREIGN KEY (movimiento_id) REFERENCES movimientos_puntos(id)
    ON DELETE CASCADE,
  INDEX idx_puntos_consumos_movimiento (movimiento_id),
  INDEX idx_puntos_consumos_lote (lote_id),
  INDEX idx_puntos_consumos_usuario (usuario_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('puntos_monto_base', '1000', 'Monto de compra que habilita un tramo de puntos.'),
  ('puntos_por_monto', '20', 'Puntos que se acreditan por cada tramo de monto configurado.'),
  ('puntos_vencimiento_meses', '6', 'Cantidad de meses de vigencia para cada lote de puntos acreditado.')
ON DUPLICATE KEY UPDATE
  descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion);

INSERT INTO puntos_lotes
  (usuario_id, movimiento_id, puntos_originales, puntos_disponibles, expires_at, origen_tipo, origen_id)
SELECT u.id, NULL, u.puntos_saldo, u.puntos_saldo, DATE_ADD(NOW(), INTERVAL 6 MONTH), 'saldo_legacy', u.id
FROM usuarios u
WHERE u.puntos_saldo > 0
  AND NOT EXISTS (
    SELECT 1
    FROM puntos_lotes pl
    WHERE pl.usuario_id = u.id
    LIMIT 1
  );
