-- Registro de presencia web para visitantes anonimos y clientes no staff.
-- Cada fila representa una ventana de 30 minutos por sesion.

CREATE TABLE IF NOT EXISTS app_presencia_registros (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  identity_key VARCHAR(80) NOT NULL,
  visitor_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  usuario_id INT NULL,
  visitante_tipo ENUM('anonimo','cliente') NOT NULL DEFAULT 'anonimo',
  bucket_start DATETIME NOT NULL,
  bucket_end DATETIME NOT NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_path VARCHAR(255) NOT NULL,
  last_path VARCHAR(255) NOT NULL,
  page_title VARCHAR(255) NULL,
  referrer VARCHAR(255) NULL,
  ip VARCHAR(64) NOT NULL,
  user_agent VARCHAR(255) NULL,
  page_views INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_presencia_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_app_presencia_bucket_identity (session_id, bucket_start, identity_key),
  INDEX idx_app_presencia_session (session_id, bucket_start),
  INDEX idx_app_presencia_last_seen (last_seen_at),
  INDEX idx_app_presencia_bucket (bucket_start),
  INDEX idx_app_presencia_visitor (visitor_id, last_seen_at),
  INDEX idx_app_presencia_usuario (usuario_id, last_seen_at),
  INDEX idx_app_presencia_tipo (visitante_tipo, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
