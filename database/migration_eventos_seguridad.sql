CREATE TABLE IF NOT EXISTS eventos_seguridad (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  evento VARCHAR(120) NOT NULL,
  ip VARCHAR(64) NOT NULL,
  metodo VARCHAR(12) NOT NULL,
  ruta VARCHAR(255) NOT NULL,
  origen VARCHAR(255) NOT NULL,
  agente_usuario VARCHAR(255) NOT NULL,
  detalles_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_eventos_seguridad_created_at (created_at),
  INDEX idx_eventos_seguridad_evento_created_at (evento, created_at),
  INDEX idx_eventos_seguridad_ip_created_at (ip, created_at)
);
