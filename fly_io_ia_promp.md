Actúa como un arquitecto de software experto en Elixir y Phoenix Framework. Tu tarea es generar una aplicación completa de E-commerce y WMS (Warehouse Management System) llamada "PhoenixCartWMS".

### 1. Stack Tecnológico
- **Framework**: Phoenix 1.7+ (con LiveView).
- **Lenguaje**: Elixir.
- **Base de Datos**: PostgreSQL.
- **Estilos**: Tailwind CSS.
- **Despliegue**: Preparado para Fly.io.
- **Autenticación**: Multi-proveedor configurable (Nextcloud, Firebase Google, AWS Cognito).

### 2. Reglas de Base de Datos (Ecto)
Debes configurar Ecto para usar **UUIDs (`binary_id`)** como claves primarias por defecto para TODAS las tablas, replicando la estructura de un sistema existente en Node.js.

**Organización por Schemas (Namespaces):**
Para mantener el orden en la base de datos, **cada Contexto debe corresponder a un SCHEMA de PostgreSQL**.
*   Las tablas del contexto `Catalog` deben ir en el schema `catalog` (ej. `catalog.products`).
*   Las tablas del contexto `Inventory` deben ir en el schema `inventory`.
*   Las tablas del contexto `Sales` deben ir en el schema `sales`.
*   Las tablas del contexto `Finance` deben ir en el schema `finance`.
*   Las tablas del contexto `Accounts` deben ir en el schema `accounts`.
*   Las tablas del contexto `Audit` deben ir en el schema `audit`.
Asegúrate de generar las migraciones para crear estos schemas (`CREATE SCHEMA IF NOT EXISTS ...`) y configurar los esquemas de Ecto con la opción `@schema_prefix`.

**Esquema de Base de Datos Requerido:**
Genera las migraciones y esquemas (Contextos) para las siguientes tablas. Asegúrate de definir las relaciones (has_many, belongs_to):

*   **Contexto `Catalog`**:
    *   `uoms`: (id: uuid, name: string, abbreviation: string).
    *   `categories`: (id: uuid, title: string, column_identifier: string, header_image: string).
    *   `products`: (id: uuid, name: string, description: text, product_type: string [enum: finished, raw_material, digital], uom_id: references uoms).
    *   `product_prices`: (id: uuid, product_id: references, public_price: decimal, cost: decimal, stock_quantity: decimal, sku: string).
    *   `product_components`: (id: uuid, parent_product_id: references products, child_product_id: references products, quantity_required: decimal). *Para recetas/kits*.

*   **Contexto `Inventory` (WMS)**:
    *   `locations`: (id: uuid, name: string, type: string [enum: warehouse, store, waste, digital], is_virtual: boolean).
    *   `inventory_ledger`: (id: uuid, product_id: references, location_id: references, quantity: decimal, transaction_type: string, notes: text). *Esta tabla es el historial inmutable de movimientos*.

*   **Contexto `Sales`**:
    *   `sessions`: (id: uuid, custom_code: string, type: string).
    *   `orders`: (id: uuid, session_id: references, total_amount: decimal, status: string).
    *   `orders`: (id: uuid, session_id: references, location_id: references locations, total_amount: decimal, status: string).
    *   `order_items`: (id: uuid, order_id: references, product_id: references, quantity: integer, price_snapshot: decimal).
    *   `order_payments`: (id: uuid, order_id: references orders, amount: decimal, payment_method: string [cash, card, transfer, gift_card], external_reference: string). *Nueva tabla para soportar pagos parciales y múltiples métodos por orden*.

*   **Contexto `Finance`**:
    *   `finance_ledger`: (id: uuid, order_id: references, type: string [income/expense], amount: decimal).
    *   `cash_shifts`: (id: uuid, location_id: references locations, user_identifier: string, start_amount: decimal, end_amount: decimal, system_amount: decimal, difference: decimal, status: string [open, closed], opened_at: datetime, closed_at: datetime). *Control de turnos y cortes de caja*.

*   **Contexto `Accounts` (Auth Multi-Proveedor)**:
    *   `users`: (id: uuid, provider_uid: string, provider: string [nextcloud, firebase, aws], username: string, email: string, role: string [enum: manager, waiter, kitchen, floor], avatar_url: string, active: boolean).
    *   *Nota*: Los roles se deben asignar mapeando grupos o claims del proveedor externo al iniciar sesión.

*   **Contexto `Audit` (Logs)**:
    *   `activity_logs`: (id: uuid, user_id: references accounts.users, action: string, entity_type: string, entity_id: uuid, details: map, created_at: datetime).
    *   *Requisito*: Registrar cada operación de escritura (Create, Update, Delete) realizada en el sistema.

### 3. Interfaz de Usuario (UI/UX) - Tema "GitHub"
Diseña la interfaz usando **Phoenix LiveView** y **Tailwind CSS** imitando estrictamente el lenguaje de diseño de GitHub (Primer CSS):

*   **Navegación**: Barra lateral izquierda o pestañas superiores con fondo gris claro (`bg-gray-50`), bordes sutiles (`border-gray-200`) e iconos pequeños.
*   **Contenedores**: Usa tarjetas con bordes redondeados (`rounded-md`), fondo blanco y bordes finos (`border border-gray-300`).
*   **Tipografía**: Sans-serif, densa, colores de texto gris oscuro (`text-gray-900`) para títulos y gris medio (`text-gray-600`) para metadatos.
*   **Botones**:
    *   Primario: Verde GitHub (`bg-green-600 hover:bg-green-700 text-white`).
    *   Secundario: Gris claro con borde (`bg-gray-100 border-gray-300 text-gray-900`).
*   **Tablas**: Estilo "Data-dense", con cabeceras gris claro (`bg-gray-50`), bordes entre filas y fuente monoespaciada para IDs y SKUs.
*   **Widgets**: Secciones tipo "Card" en un layout Flex/Grid responsive. Deben incluir título, métrica principal grande, filtros (nombre, fecha) y botones de acción ("Ver registro").

### 4. Funcionalidades Clave a Generar
1.  **Dashboard Principal (Sistema de Widgets)**:
    Crea una vista principal con los siguientes widgets responsivos:
    *   **Status Órdenes**: Contador de órdenes abiertas. Enlaces rápidos a órdenes cerradas, pagadas y rechazadas.
    *   **Top Productos**: Lista del top 10 productos más agregados al carrito, más ordenados y más vendidos. Enlace al catálogo.
    *   **Alertas de Resurtido**: Lista de productos con stock bajo (resurtibles). Filtros para ver: resurtibles / no resurtibles / todos.
    *   **Métricas del Sistema**: Contadores actuales de UOMs, Categorías, Productos, Locaciones, Sesiones y Órdenes.
    *   **Finanzas (Pagadas)**: Resumen de ventas cobradas por Día, Semana y Mes (Total y Promedio). Enlace al Ledger de pagos.
    *   **Proyección (Abiertas)**: Resumen de órdenes abiertas (potencial venta) por Día, Semana y Mes (Total y Promedio).
    *   **Control de Caja**: Indicador de cajas abiertas actualmente por sucursal. Alerta visual de los últimos 5 cortes con diferencias (faltantes/sobrantes) para atención inmediata.
    *   **Usuarios Activos**: Lista compacta de usuarios conectados recientemente y sus roles.
    *   **Auditoría de Catálogo**: Widget con lista de los últimos 5 productos modificados y un **Contador de Productos Incompletos** (sin precio, sin imagen o recetas sin componentes definidos) que requieren atención para completarse.

2.  **Vista "Comanda" (Mesero)**:
    *   Simulación de toma de pedidos en restaurante.
    *   Permitir seleccionar una sesión existente o crear una nueva.
    *   Agregar productos y **crear la orden** enviándola a cocina (Estado inicial: `processing`).

3.  **Vista "Cocina" (KDS - Kitchen Display System)**:
    *   Tablero para visualizar órdenes en estado `processing`.
    *   Acciones para marcar órdenes como `ready_to_serve` (Listas para servir) o `delivered` (Entregadas).

4.  **Vista "Caja" (POS con Pagos Múltiples)**:
    *   Listado de órdenes en estado `ready_to_serve` o pendientes de pago.
    *   **Interfaz de Cobro**: Debe permitir registrar pagos en la tabla `order_payments`.
    *   Soporte para **múltiples formas de pago** en una misma orden (ej. parte en efectivo, parte en tarjeta, parte en vales) en diferentes tiempos.
    *   La orden solo se marca como `paid` (y se cierra) cuando la suma de los pagos cubre el `total_amount`.

5.  **Vista "Historial de Cortes de Caja" (Auditoría)**:
    *   Tabla completa de `cash_shifts` con filtros avanzados: Rango de Fechas, Sucursal (`location_id`), Cajero (`user_identifier`) y Estado (`open`/`closed`).
    *   **Visualización de Diferencias**: Resaltar filas con colores semánticos (Rojo para faltantes > umbral, Verde para sobrantes, Gris para cuadrado).
    *   **Gráfica de Tendencias**: Chart lineal mostrando la evolución de la columna `difference` en el tiempo para detectar patrones de robo o error sistemático.
    *   **Detalle de Corte**: Vista modal o separada que muestre el `system_amount` vs `end_amount` y la lista de transacciones asociadas a ese turno.

6.  **Gestión de Usuarios y Auditoría**:
    *   **Autenticación Multi-Proveedor**: Implementar soporte flexible para **Nextcloud**, **Firebase (Google)** y **AWS Cognito**.
    *   **Variables de Entorno**: El sistema debe configurarse mediante `.env` para seleccionar el proveedor activo y sus credenciales (ej. `AUTH_PROVIDER`, `NEXTCLOUD_URL`, `NEXTCLOUD_CLIENT_ID`, `FIREBASE_API_KEY`, `AWS_COGNITO_USER_POOL_ID`, etc.).
    *   **Sincronización**: Al loguearse, sincronizar datos y asignar rol basado en grupos/claims del proveedor seleccionado.
    *   **Directorio de Usuarios**: Vista de tabla con usuarios registrados, roles actuales y estado.
    *   **Botón "Ver Historial"**: En TODAS las vistas de detalle (Producto, Orden, Corte de Caja), incluir un botón que abra un *Drawer* o Modal con la tabla de `activity_logs` filtrada por ese `entity_id`.
    *   **Log Global**: Una vista administrativa para explorar todos los logs con filtros por Usuario, Acción y Fecha.

7.  **Gestor de Recetas y Jerarquías (Árbol de Productos)**:
    *   **Vista de Árbol (Tree View)**: Implementar una interfaz visual jerárquica para navegar entre Categorías -> Productos Padre -> Sub-productos/Ingredientes.
    *   **Editor de Composiciones**: Al seleccionar un producto compuesto, permitir editar sus `product_components` (receta) de forma visual: agregar ingredientes, definir cantidades y UOMs.
    *   **Gestión de Grupos**: Crear y editar grupos de productos y sub-productos directamente desde el árbol.

### 5. API y Conectividad (REST, gRPC y n8n)
Además de la interfaz LiveView, el sistema debe exponer una API robusta para integraciones externas y automatización.

1.  **Protocolos Híbridos**:
    *   **REST API**: Implementar endpoints JSON bajo el scope `/api/v1` para todas las entidades principales.
    *   **gRPC**: Configurar soporte para servicios gRPC (usando `grpc` y `protobuf`) para operaciones de alta frecuencia como sincronización de inventario y actualizaciones de estado en tiempo real (Cocina/Caja).

2.  **Endpoints Operativos Específicos**:
    *   **Cocina (KDS)**: `GET /api/v1/kitchen/queue` (órdenes `processing`), `POST /api/v1/kitchen/orders/:id/advance` (cambiar estado).
    *   **Comandas**: `POST /api/v1/orders` (crear), `PATCH /api/v1/orders/:id` (modificar items).
    *   **Caja (POS)**: `GET /api/v1/pos/pending` (órdenes por cobrar), `POST /api/v1/pos/pay` (registrar pagos múltiples).

3.  **Catálogo de Rutas (Auto-documentación)**:
    *   Crear un endpoint `GET /api/routes` que devuelva un JSON listando todas las rutas disponibles del sistema.
    *   **Estructura**: `{ "method": "GET", "path": "/api/v1/products", "description": "Lista productos activos", "module": "MyAppWeb.ProductController" }`.

4.  **Generador de Especificaciones para n8n (AI Tools)**:
    *   Implementar un endpoint `GET /api/tools/n8n-spec` que genere dinámicamente un JSON con la definición de herramientas ("Tools") compatible con agentes de IA (como n8n o OpenAI Functions).
    *   **Contenido**: Debe describir funciones clave (Consultar Stock, Crear Orden, Ver Menú) con sus parámetros requeridos y descripciones de corta a mediana longitud **siempre en inglés**.
    *   **Ejemplo de Salida**:
        ```json
        [
          {
            "name": "check_inventory",
            "description": "Verifica la disponibilidad de un producto en una ubicación específica.",
            "parameters": { "type": "object", "properties": { "product_id": { "type": "string" } } },
            "url": "/api/v1/inventory/check"
          }
        ]
        ```

Por favor, genera el comando de creación del proyecto (`mix phx.new ...`) y el código para las migraciones y los esquemas Ecto principales.
