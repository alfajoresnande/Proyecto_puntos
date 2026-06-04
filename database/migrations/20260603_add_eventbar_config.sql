INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('eventbar_activo', '0',
        'Activa o desactiva la barra superior de evento temporal.'),
    ('eventbar_titulo', '',
        'Texto principal que se muestra en la barra superior de evento.'),
    ('eventbar_subtitulo', '',
        'Texto secundario que se muestra debajo del titulo en la barra superior de evento.'),
    ('eventbar_fecha_fin', '',
        'Fecha y hora ISO en la que termina el evento de la barra superior.'),
    ('eventbar_color_fondo', '#2D1A0D',
        'Color de fondo de la barra superior de evento.'),
    ('eventbar_color_texto', '#F3C47B',
        'Color de texto de la barra superior de evento.')
ON DUPLICATE KEY UPDATE
    descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion);
