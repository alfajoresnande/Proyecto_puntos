INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('home_ubicacion_imagen_1_link', '',
        'Link opcional para la imagen principal izquierda de la seccion Donde encontrarnos del home'),
    ('home_ubicacion_imagen_2_link', '',
        'Link opcional para la imagen superior derecha de la seccion Donde encontrarnos del home'),
    ('home_ubicacion_imagen_3_link', '',
        'Link opcional para la imagen inferior derecha de la seccion Donde encontrarnos del home')
ON DUPLICATE KEY UPDATE
    descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion);
