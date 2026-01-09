# API Shopping Cart & WMS (Node.js + PostgreSQL)

Este proyecto es una API RESTful robusta diseñada para operar como backend de una plataforma de comercio electrónico. Incluye funcionalidades avanzadas de **Carrito de Compras**, **Gestión de Pedidos**, **Sistema WMS (Warehouse Management System)** para control de inventarios multicapa y un **Libro Contable (Ledger)** para el registro financiero.

Está optimizada para desplegarse en **Google Cloud Platform** (Cloud Run / App Engine) y utiliza **PostgreSQL** como motor de base de datos.

## 🚀 Características Principales

*   **Catálogo Dinámico**: Reconstrucción de menús anidados complejos (estilo JSON jerárquico).
*   **Carrito Persistente**: Gestión de sesiones y carritos de compra.
*   **WMS / Inventarios**:
    *   Soporte para múltiples ubicaciones (Almacenes, Tiendas, Mermas, Nube).
    *   Unidades de Medida (UOMs) personalizables (Kg, Pz, Lt, etc.).
    *   Recetas y Conversiones (Transformación de materia prima a producto terminado).
    *   Kardex de inventario (Entradas, Salidas, Transferencias).
*   **ERP Financiero Ligero**:
    *   Registro inmutable de transacciones (Ledger).
    *   Balance por sesión y control de flujo de efectivo.
*   **Seguridad**: Implementación de Helmet, CORS estricto y validaciones.

## 🛠️ Stack Tecnológico

*   **Runtime**: Node.js
*   **Framework**: Express.js
*   **Base de Datos**: PostgreSQL (con extensión `pgcrypto` para UUIDs)
*   **Librerías Clave**: `pg` (cliente DB), `helmet` (seguridad), `cors`, `morgan` (logging).

## 📦 Instalación y Configuración

### 1. Prerrequisitos
*   Node.js (v18 o superior recomendado)
*   PostgreSQL (Local o Cloud SQL)

### 2. Instalación de dependencias
```bash
npm install
```

### 3. Variables de Entorno (.env)
Crea un archivo `.env` en la raíz del proyecto con las siguientes credenciales:

```env
PORT=14420
NODE_ENV=development

# Configuración de Base de Datos
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_HOST=localhost
DB_NAME=shopping_cart_db
DB_PORT=5432
```

### 4. Ejecución
```bash
# Modo desarrollo (con autoreload)
npm run dev

# Modo producción
npm start
```

---

## 🗄️ Base de Datos y Migraciones

El sistema cuenta con un endpoint de auto-migración que crea o actualiza el esquema de la base de datos automáticamente.

**Endpoint**: `GET /migrations`

> **⚠️ Nota**: En desarrollo, este endpoint puede ejecutar `DROP TABLE` para reiniciar el esquema. Revisa el código en producción.

### Tablas Principales:
*   `products`, `categories`: Catálogo base.
*   `product_prices`: Precios y stock cacheado.
*   `product_components`: Recetas para conversión de productos.
*   `inventory_ledger`: Historial detallado de movimientos de inventario.
*   `locations`: Almacenes y puntos de venta.
*   `orders`, `order_items`: Registro de ventas.
*   `ledger`: Registro financiero.

---

## 📚 Documentación de API

### 1. Sistema
*   `GET /`: Health check. Devuelve estado del servidor y timestamp.

### 2. Catálogo y Productos
*   `GET /menu`: Devuelve el catálogo completo estructurado jerárquicamente (Columnas -> Categorías -> Items) listo para el frontend.
*   `GET /categories`: Lista todas las categorías.
*   `POST /categories`: Crea una nueva categoría.
*   `GET /products`: Lista productos (vista plana).
*   `POST /products`: Crea un producto complejo. Distribuye datos a tablas de precios, media y detalles.
    *   *Body*: `{ name, price, image, category_id, product_type, uom_id, ... }`
*   `GET /products/:id/prices`: Obtiene precios e inventario de un producto.

### 3. Carrito de Compras (Shopping Cart)
*   `POST /sessions`: Inicia o recupera una sesión de usuario.
    *   *Body*: `{ type: "guest", custom_code: "usr_1", origin: "web" }`
*   `GET /cart/:session_id`: Obtiene el contenido del carrito con detalles de productos.
*   `POST /cart`: Agrega un item al carrito.
*   `PUT /cart/:id`: Actualiza cantidad de un item.
*   `DELETE /cart/:id`: Elimina un item del carrito.

### 4. Pedidos (Orders)
*   `POST /orders`: **Checkout**. Convierte el carrito en una orden.
    *   *Acciones*:
        1. Crea la orden y congela los precios de los items (`order_items`).
        2. Descuenta stock del inventario (`inventory_ledger`) de la ubicación 'store'.
        3. Registra la entrada de dinero en el libro contable (`ledger`).
        4. Vacía el carrito.
    *   *Body*: `{ session_id, payment_method, received_amount }`
*   `GET /orders/:id`: Obtiene el detalle de una orden específica.

### 5. WMS (Gestión de Inventarios Avanzada)
Este módulo permite un control granular del stock más allá de una simple cantidad.

#### Catálogos WMS
*   `GET /inventory/catalogs`: Devuelve lista de UOMs (Unidades de Medida) y Locations (Ubicaciones).

#### Movimientos de Inventario
*   `POST /inventory/transaction`: Registra entradas, salidas o transferencias.
    *   *Ejemplo Compra (Entrada)*:
        ```json
        {
          "product_id": "uuid...",
          "location_id": "uuid_almacen",
          "quantity": 100,
          "type": "purchase"
        }
        ```
    *   *Ejemplo Transferencia (Almacén -> Tienda)*:
        ```json
        {
          "product_id": "uuid...",
          "location_id": "uuid_almacen",
          "to_location_id": "uuid_tienda",
          "quantity": 20,
          "type": "transfer"
        }
        ```

#### Producción y Conversión
*   `POST /inventory/convert`: Transforma materia prima en producto terminado basándose en recetas (`product_components`).
    *   *Body*: `{ parent_product_id, quantity_to_produce, location_id }`
    *   *Efecto*: Resta ingredientes (ej. carne, pan) y suma producto final (hamburguesa).

#### Consultas
*   `GET /inventory/stock/:product_id`: Muestra el stock desglosado por ubicación (cuánto hay en almacén, cuánto en tienda, etc.).

### 6. Finanzas (Ledger)
*   `GET /finance/balance/:session_id`: Devuelve el balance financiero de una sesión (Total Ingresos - Total Egresos).
*   `GET /finance/history/:session_id`: Historial paginado de transacciones financieras.

---

## 🧪 Flujo de Prueba Recomendado

1.  **Inicialización**: Ejecuta `GET /migrations` para crear tablas y datos semilla (UOMs, Ubicaciones).
2.  **Crear Catálogo**:
    *   Crea una categoría (`POST /categories`).
    *   Crea un producto (`POST /products`) definiendo su tipo (ej. 'finished' o 'raw_material').
3.  **Abastecer Inventario**:
    *   Usa `POST /inventory/transaction` para dar entrada a stock en el 'Almacén General'.
    *   Transfiere stock a 'Tienda Principal' para que esté disponible para venta.
4.  **Venta**:
    *   Crea sesión (`POST /sessions`).
    *   Agrega al carrito (`POST /cart`).
    *   Finaliza compra (`POST /orders`).
5.  **Verificación**:
    *   Revisa `GET /orders/:id` para ver la orden.
    *   Revisa `GET /inventory/stock/:id` para ver que el stock disminuyó en la tienda.
    *   Revisa `GET /finance/balance/:session_id` para ver el ingreso registrado.

---
Desarrollado por **comsis.mx**
