INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('puntos_alerta_pre_vencimiento_valor', '1',
        'Cantidad de semanas o meses de anticipacion para avisar que los puntos estan por vencer'),
    ('puntos_alerta_pre_vencimiento_unidad', 'meses',
        'Unidad de anticipacion para avisar puntos por vencer: semanas o meses')
ON DUPLICATE KEY UPDATE
    descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion);
