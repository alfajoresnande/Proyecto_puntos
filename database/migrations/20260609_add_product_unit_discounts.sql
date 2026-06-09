CREATE TABLE IF NOT EXISTS descuentos_tipo_producto (
  id INT PRIMARY KEY AUTO_INCREMENT,
  tipo_cliente ENUM('cliente','mayorista','empleado') NOT NULL,
  producto_id INT NOT NULL,
  descuento_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_descuento_tipo_producto UNIQUE (tipo_cliente, producto_id),
  INDEX idx_descuentos_tipo_producto_producto (producto_id),
  CONSTRAINT fk_descuentos_tipo_producto_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
);
