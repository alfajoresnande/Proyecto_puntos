# Credenciales administrativas — rotación y limpieza (SEC-02)

> **Estado: acción manual pendiente.** El código ya no contiene credenciales,
> pero eso **no** arregla lo que ya pasó. Las cuentas siguen comprometidas
> hasta que alguien haga los pasos de este documento.

## Qué pasó

`database/schema.sql` incluía un `INSERT` que creaba dos cuentas `admin` con
`activo = 1`, y un comentario justo encima con **las contraseñas en texto
claro**. El archivo está en Git, así que esas credenciales las vio todo el que
tuviera acceso al repositorio —y siguen en el historial aunque hoy el archivo
esté limpio.

La auditoría rastreó el secreto hasta el commit `995fe11` (`pre-deploy`).

## Qué se corrigió en el código

- Se eliminaron del `schema.sql` las dos cuentas, los hashes y el comentario
  con las contraseñas.
- Se agregó un bootstrap de un solo uso por variables de entorno:
  `backend/src/scripts/bootstrapAdmin.ts`.

## Qué falta hacer a mano — en este orden

### 1. Rotar las contraseñas de las dos cuentas

Las cuentas siguen existiendo en la base de producción. Con la clave nueva ya
elegida (no la generes acá ni la pegues en ningún archivo):

```bash
ADMIN_BOOTSTRAP_EMAIL=<la-cuenta-admin> ADMIN_BOOTSTRAP_PASSWORD=<clave-nueva> ADMIN_BOOTSTRAP_FORCE=true npm run admin:bootstrap --prefix backend
```

El script sube `token_version`, así que **todas las sesiones abiertas de esa
cuenta quedan invalidadas en el acto**. Repetir para la segunda cuenta.

Después, borrar la variable del historial del shell:

```bash
history -d $(history 1)
```

### 2. Deshabilitar la que no se use

Si sólo hace falta una cuenta administrativa, desactivar la otra desde el panel
(`PATCH /api/admin/usuarios/:id/activo`). Desactivar también corta sus sesiones.

### 3. Auditar los accesos

Revisar en la base:

```sql
SELECT * FROM eventos_seguridad
 WHERE evento LIKE 'login%' OR evento LIKE 'password%'
 ORDER BY creado_en DESC LIMIT 200;

SELECT id, email, rol, activo, token_version FROM usuarios WHERE rol IN ('admin','superAdmin');
```

Buscar accesos desde IPs o dispositivos que no reconozcas, y cambios de rol o
de estado que nadie del equipo haya hecho.

### 4. Tratar las contraseñas como comprometidas en cualquier otro lado

Si alguna de esas dos contraseñas se reutilizó en otro servicio (correo,
hosting, panel de Mercado Pago, phpMyAdmin), **cambiarla ahí también**. Que la
cuenta de este proyecto ya esté rotada no ayuda si la misma clave abre el
correo de Protonmail.

### 5. Reescribir el historial de Git — operación destructiva, coordinar antes

**No lo hice automáticamente a propósito.** Reescribir el historial cambia
todos los SHA posteriores, invalida los clones existentes y requiere un
`push --force` coordinado. Se hace **después** de rotar las credenciales, no en
lugar de rotarlas: mientras el commit exista en un clon, un fork o la caché de
GitHub, la contraseña sigue expuesta.

Procedimiento sugerido, con `git-filter-repo` (más seguro que `filter-branch`):

```bash
git clone --mirror <url-del-repo> repo-limpio.git
```

```bash
cd repo-limpio.git && git filter-repo --path database/schema.sql --invert-paths --force
```

Eso borra el archivo entero del historial. Si preferís conservar el archivo y
quitar sólo las líneas, usar `--replace-text` con un archivo de reemplazos:

```bash
git filter-repo --replace-text reemplazos.txt --force
```

donde `reemplazos.txt` tiene una línea por secreto, con el formato
`<literal>==><REMOVED>`. Ese archivo contiene secretos: **borralo después y no
lo commitees**.

Luego, con todo el equipo avisado y sin trabajo sin pushear:

```bash
git push --force --mirror <url-del-repo>
```

Y finalmente:

- Todos vuelven a clonar de cero. Un `git pull` sobre un clon viejo reintroduce
  los commits.
- Pedir a GitHub/GitLab que purguen la caché de commits huérfanos (en GitHub se
  hace abriendo un ticket de soporte).
- Revisar forks y mirrors: el historial viejo puede seguir ahí.

### 6. Verificar que no quedó nada

```bash
git log --all -S "<la-contrasena-filtrada>" --oneline
```

Sin salida = limpio en el historial local. Sustituí el marcador por la
contraseña real al ejecutarlo, y **no dejes el comando en el historial del
shell** (`history -d $(history 1)`). Este documento no la contiene a propósito.

## Bootstrap de un entorno nuevo

Para una instalación desde cero, después de aplicar `schema.sql`:

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@ejemplo.com ADMIN_BOOTSTRAP_PASSWORD=<clave-elegida> npm run admin:bootstrap --prefix backend
```

Sin `ADMIN_BOOTSTRAP_FORCE`, el script **no hace nada** si ya existe alguna
cuenta `admin` o `superAdmin`: por eso es de un solo uso. Requisitos de la
clave: 12+ caracteres con minúsculas, mayúsculas, números y un símbolo. El
script nunca genera ni imprime la contraseña.
