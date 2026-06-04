INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('eventbar_descuento_especial_activo', '0',
        'Activa el descuento especial de la eventbar para precios de tienda online.'),
    ('eventbar_descuento_especial_tipo', 'none',
        'Tipo de descuento especial de la eventbar: none, 2x1, 3x2 o 4x3.')
ON DUPLICATE KEY UPDATE
    descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion);
