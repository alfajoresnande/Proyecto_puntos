INSERT INTO configuracion (clave, valor, descripcion) VALUES
    ('eventbar_activo', '0',
        'Activa o desactiva la barra superior de evento temporal.'),
    ('eventbar_titulo', '',
        'Texto principal que se muestra en la barra superior de evento.'),
    ('eventbar_fecha_fin', '',
        'Fecha y hora ISO en la que termina el evento de la barra superior.'),
    ('eventbar_color_fondo', '#6B3E26',
        'Color de fondo de la barra superior de evento.'),
    ('eventbar_color_texto', '#FFFFFF',
        'Color de texto de la barra superior de evento.')
ON DUPLICATE KEY UPDATE
    descripcion = COALESCE(NULLIF(VALUES(descripcion), ''), configuracion.descripcion);
