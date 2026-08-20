INSERT INTO configuracion (clave, valor, descripcion)
VALUES
  ('modo_venta', 'ecommerce', 'Modo de venta: ecommerce con stock y pagos, o catalogo_whatsapp para consultas manuales.'),
  ('whatsapp_pedidos_numero', '5493794632610', 'Numero de WhatsApp de pedidos, con codigo de pais y solo digitos.')
ON DUPLICATE KEY UPDATE
  valor = configuracion.valor,
  descripcion = VALUES(descripcion);

CREATE TABLE IF NOT EXISTS cobros_manuales (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  monto DECIMAL(10,2) NOT NULL,
  moneda VARCHAR(8) NOT NULL DEFAULT 'ARS',
  concepto VARCHAR(180) NOT NULL,
  cliente_nombre VARCHAR(160) NULL,
  cliente_telefono VARCHAR(40) NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'iniciado',
  proveedor VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  metodo VARCHAR(40) NOT NULL DEFAULT 'wallet',
  preference_id VARCHAR(160) NULL,
  provider_payment_id VARCHAR(160) NULL,
  checkout_url VARCHAR(700) NULL,
  qr_image_data MEDIUMTEXT NULL,
  payload_json JSON NULL,
  error_mensaje VARCHAR(500) NULL,
  creado_por INT NOT NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cobros_manuales_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ON DELETE RESTRICT,
  INDEX idx_cobros_manuales_estado_created_at (estado, created_at),
  INDEX idx_cobros_manuales_preference_id (preference_id),
  INDEX idx_cobros_manuales_provider_payment_id (provider_payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
