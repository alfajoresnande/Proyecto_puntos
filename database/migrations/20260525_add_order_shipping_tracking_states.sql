ALTER TABLE ordenes
  MODIFY estado ENUM(
    'borrador',
    'pendiente_pago',
    'pagada',
    'preparandose',
    'preparada',
    'enviada',
    'entregando',
    'entregada',
    'cancelada',
    'expirada'
  ) NOT NULL DEFAULT 'borrador';
