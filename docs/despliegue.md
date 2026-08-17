# Guía de despliegue y operación

Todo lo que hay que saber para poner en producción y mantener la app, sin
necesidad de consola SSH. Escrito para que lo pueda seguir alguien que nunca
tocó este proyecto.

---

## 1. Cómo está armado el hosting

Hay **dos dominios** y hacen cosas distintas:

| Dominio | Qué es | Servido por |
|---|---|---|
| `alfajorescorrentinos.com` | La tienda (frontend React) | Apache, archivos estáticos |
| `nandengineer.shop` | La API (backend Node) | LiteSpeed → Node |

Si abrís `nandengineer.shop/tienda` en el navegador vas a ver `Cannot GET /tienda`.
**Eso es normal**: ese dominio no sirve páginas, solo la API y las imágenes.

### El detalle que más problemas trae

Hostinger despliega por **versiones**. Cada deploy crea una carpeta nueva:

```
/home/<TU_USUARIO>/domains/nandengineer.shop/hbuilds/versions/<uuid>/nodejs/
```

Y mueve un enlace `current` para apuntar a la última. **Nada de lo que esté
dentro de esa carpeta sobrevive al siguiente deploy.** Incluida `uploads`.

> Para saber tu `<TU_USUARIO>`: abrí el gestor de archivos y mirá la barra de
> ruta parado en la casita. Tiene la forma `uXXXXXXXXX` (una `u` y nueve dígitos).

---

## 2. La carpeta `uploads` — hacelo bien una vez y olvidate

Ahí viven las fotos de productos, categorías y páginas. **Si se pierden, se
pierden las imágenes de todo el catálogo.**

### Configuración recomendada (una sola vez)

1. Creá una carpeta **fuera** de `hbuilds`, por ejemplo:
   ```
   /home/<TU_USUARIO>/uploads_live
   ```
2. Copiá ahí todas las imágenes actuales.
3. En el panel de Hostinger → **Node.js** → **Variables de entorno**, agregá:
   ```
   UPLOADS_DIR=/home/<TU_USUARIO>/uploads_live
   ```
4. Reiniciá la aplicación.
5. Verificá en el log que diga:
   ```
   [uploads] Sirviendo archivos estáticos desde: /home/<TU_USUARIO>/uploads_live (origen: variable de entorno UPLOADS_DIR)
   ```

Con esto **los deploys no vuelven a tocar las imágenes nunca más**, y no hay
que copiar nada después de cada despliegue.

### Si NO está configurado `UPLOADS_DIR`

La app usa la carpeta `uploads` que está dentro del código desplegado. Eso
obliga a, **después de cada deploy**, volver a copiar las imágenes a:

```
/home/<TU_USUARIO>/domains/nandengineer.shop/hbuilds/versions/<uuid>/nodejs/backend/uploads
```

donde `<uuid>` es la versión nueva. Es tedioso y fácil de olvidar: por eso se
recomienda lo de arriba.

> **Nunca borres los archivos `.png` o `.jpg` originales.** De ellos se generan
> las versiones WebP. Si borrás el original y se pierde el WebP, no hay forma
> de recuperarlo.

---

## 3. Desplegar

### Backend

El deploy se dispara con un `push` a `main`. Dos cosas obligatorias antes:

**a) Compilar y commitear `backend/dist`**

```bash
npm run build --prefix backend
git add backend/dist
```

Producción ejecuta el `dist` versionado, **no** compila en el servidor. Si
cambiás algo en `backend/src` y no commiteás el `dist`, el cambio no llega.

**b) Las dependencias van en el `package.json` de la RAÍZ**

El hosting instala solo desde la raíz del repo. Si agregás una librería que
usa el backend y la ponés únicamente en `backend/package.json`, **en
producción no se instala** y falla en tiempo de ejecución.

```bash
npm install <paquete> --save     # en la raíz, no en backend/
```

### Frontend

```bash
npm run build --prefix frontend
```

Subir el contenido de `frontend/dist` al `public_html` de
`alfajorescorrentinos.com`. Incluye el `.htaccess`, que controla el cacheo.

---

## 4. Después de cada deploy: la checklist

1. **Reiniciar la app Node** desde el panel. El deploy deja los archivos
   nuevos, pero el proceso sigue ejecutando el código viejo en memoria hasta
   que se reinicia.
2. Si no configuraste `UPLOADS_DIR`: **copiar las imágenes** a la carpeta de
   la versión nueva.
3. **Revisar el log de arranque** (ver la sección siguiente).
4. Abrir la tienda y comprobar que se ven las imágenes.

---

## 5. Leer el log

No hay consola: los logs son archivos. Abrí **`console.log`** desde el gestor
de archivos y buscá `[uploads]`. Al arrancar tienen que aparecer estas líneas:

```
[uploads] Sirviendo archivos estáticos desde: <ruta> (origen: <origen>)
[uploads] 108 imagen(es) canonica(s), 16 variante(s) generada(s).
✅ MySQL conectado
API en http://localhost:4000
```

Qué mirar:

- **La ruta** es la carpeta que la app está usando de verdad. Si no es la que
  creés, ahí está el problema.
- **El número de imágenes.** Si dice 8, está viendo solo las de ejemplo del
  repo: tus imágenes no están donde la app las busca.
- **Si aparece `ATENCION: sharp no se pudo cargar`**, la conversión a WebP no
  va a funcionar (ver problema 3 más abajo). La tienda funciona igual.

---

## 6. Problemas frecuentes

### 1. Las imágenes no se ven (404)

**Causa:** los archivos no están en la carpeta que la app está sirviendo.

**Cómo confirmarlo:** pedí una imagen directo en el navegador:
```
https://nandengineer.shop/uploads/<nombre-del-archivo>.png
```
- **404 en un pedido individual** → el archivo no está. Revisá la ruta del log.
- **503 pero solo al cargar la tienda entera** → no es lo mismo, ver abajo.

**Solución:** copiar las imágenes a la ruta que dice el log, o configurar
`UPLOADS_DIR` (sección 2).

### 2. Las imágenes dan 503 al abrir la tienda, pero una sola anda bien

**Causa:** la tienda pide ~20 imágenes de golpe y el servidor se satura
convirtiéndolas.

**Solución:** ninguna, se resuelve solo. Las conversiones están limitadas a dos
simultáneas y cada imagen se convierte una única vez. Recargá: a partir de la
segunda visita salen de disco y vuelan.

### 3. En el log dice `Cannot find module 'sharp'`

**Causa:** `sharp` no se instaló. Casi siempre es porque la dependencia quedó
declarada solo en `backend/package.json` y el hosting instala desde la raíz.

**Solución:** verificá que `sharp` esté en `dependencies` del `package.json` de
la raíz, commiteá también el `package-lock.json`, y volvé a desplegar.

**Mientras tanto:** la app sigue funcionando y las imágenes se ven; lo único
que no anda es la conversión a WebP y la subida de imágenes nuevas.

### 4. Cambié algo del backend y no se refleja

Dos causas posibles, casi siempre la primera:

1. No se commiteó `backend/dist` (ver sección 3a).
2. No se reinició la app después del deploy.

### 5. Los archivos de `backend/dist` aparecen modificados sin haberlos tocado

Es ruido de fin de línea (CRLF vs LF), no cambios reales. Comprobalo con:

```bash
git diff --numstat backend/dist
```

Si no devuelve nada, no hay cambios de contenido.

---

## 7. Cómo funcionan las imágenes

Entender esto ahorra tiempo cuando algo falla.

**Al subir una imagen desde el panel:** se valida, se reencodea a WebP (máximo
1600px de ancho) y se generan dos variantes, `-card` (600px) y `-thumb`
(300px). El archivo original crudo se borra y en la base queda guardada la
ruta `.webp`. Es automático: no hay que hacer nada.

**Con las imágenes viejas** (anteriores a este sistema) puede pasar que la base
apunte a un `.png` y no existan las variantes. No es problema: cuando el
navegador pide un `.webp` que no está, el servidor lo genera en ese momento a
partir del original que haya en disco, lo guarda y lo sirve. Pasa una sola vez
por imagen.

Esto funciona **en las dos direcciones**: si la base pide `.webp` y en disco
está el `.png`, se genera; si pide `.png` y solo queda el `.webp`, se sirve el
WebP. Por eso no importa que la base y los archivos estén desincronizados.

### Pasar toda la base a WebP (opcional)

Mejora el peso en el detalle de producto y en el panel. En phpMyAdmin,
**después de exportar un backup**:

```sql
UPDATE productos
SET imagen_url = REGEXP_REPLACE(imagen_url, '\\.(png|jpe?g)$', '.webp')
WHERE imagen_url REGEXP '\\.(png|jpe?g)$';
```

Repetir para `productos.imagen_mobile_url`, `producto_imagenes.imagen_url`,
`categorias.imagen_url` y `layout_timeline_eventos.imagen_url`.

Los WebP se generan solos en el primer pedido. **No borres los originales.**

---

## 8. Programa de puntos

Se prende y apaga desde el panel de administración, sin tocar código ni base.
El interruptor está en la configuración general y solo lo ve el rol de mayor
privilegio.

Con el programa apagado: las compras no acreditan puntos, se bloquean los
canjes y las cargas manuales, se pausan los vencimientos y toda la sección
desaparece de la app. **Los saldos de los clientes se conservan intactos** y al
reactivarlo vuelve todo como estaba.

---

## 9. Backups

- **Base de datos:** phpMyAdmin → pestaña *Exportar*. Hacelo **siempre** antes
  de ejecutar cualquier `UPDATE`.
- **Imágenes:** copiar la carpeta `uploads` completa. Guardala fuera de
  `hbuilds` para que ningún deploy la toque.
- El panel de admin también genera un backup completo (base + uploads) desde
  la sección correspondiente.
