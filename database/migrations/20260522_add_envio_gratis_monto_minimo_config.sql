INSERT INTO configuracion (clave, valor, descripcion)
VALUES (
  'envio_gratis_monto_minimo',
  '0',
  'Monto minimo de productos para que el envio sea gratis. 0 desactiva la regla'
)
ON DUPLICATE KEY UPDATE
  descripcion = VALUES(descripcion);
