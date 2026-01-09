require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Pool } = require('pg');

// Configuración de la Base de Datos (PostgreSQL)
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const app = express();

// 1. SEGURIDAD: Helmet
// Configura cabeceras HTTP apropiadas para ocultar información del servidor
// y proteger contra vulnerabilidades conocidas.
app.use(helmet());

// 2. LOGGING: Morgan
// Útil para ver los logs de las peticiones en la consola de Google Cloud.
app.use(morgan('combined'));

// 3. SEGURIDAD: Configuración de CORS
// Lista blanca de orígenes permitidos
const whitelist = [
  'http://localhost:3000', // Localhost (Frontend dev)
  'http://localhost:14420', // Localhost (Testing)
  'https://lasombradetusalas.com', // Producción
  'https://www.lasombradetusalas.com' // Subdominio www
];

const corsOptions = {
  origin: function (origin, callback) {
    // !origin permite peticiones sin origen (como Postman o curl)
    // Si quieres ser ESTRICTO y solo permitir navegadores, quita "|| !origin"
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      console.warn(`Bloqueado por CORS: ${origin}`);
      callback(new Error('Acceso no permitido por CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Middleware para parsear JSON
app.use(express.json());

// ---------------------------------------------------------
// RUTA DE MIGRACIONES (Creación de Tablas)
// ---------------------------------------------------------
app.get('/migrations', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Habilitar extensión para UUIDs
      await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

      // Limpieza para recrear estructura (SOLO PARA DESARROLLO INICIAL)
      // En producción, usarías ALTER TABLE en lugar de DROP
      await client.query('DROP TABLE IF EXISTS inventory_ledger, product_components, locations, uoms, ledger, order_items, orders, cart_items, sessions, product_media, product_prices, products, categories CASCADE');

      // 1. Tabla Categories
      await client.query(`
        CREATE TABLE IF NOT EXISTS categories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          column_identifier VARCHAR(50) NOT NULL, 
          title VARCHAR(255) NOT NULL,
          header_image TEXT,
          status VARCHAR(50) DEFAULT 'active',
          status_sys VARCHAR(50) DEFAULT 'system',
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      // 1.1 Tabla UOMs (Unidades de Medida) - NUEVA
      await client.query(`
        CREATE TABLE IF NOT EXISTS uoms (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(50) NOT NULL, -- Kilogramo, Pieza, Caja, Litro
          abbreviation VARCHAR(10) NOT NULL, -- kg, pz, cja, lt
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
        -- Insertar UOMs base por defecto
        INSERT INTO uoms (name, abbreviation) VALUES 
        ('Pieza', 'pz'), ('Kilogramo', 'kg'), ('Litro', 'lt'), ('Caja', 'cja'), ('Paquete', 'paq'), ('Licencia Digital', 'key')
        ON CONFLICT DO NOTHING;
      `);

      // 2. Tabla Products
      await client.query(`
        CREATE TABLE IF NOT EXISTS products (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
          category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
          category_uuid UUID REFERENCES categories(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          detail TEXT,
          product_type VARCHAR(50) DEFAULT 'finished', -- raw_material (ingrediente), finished (venta), digital, service
          uom_id UUID REFERENCES uoms(id), -- Unidad base del producto
          digital_data TEXT, -- Para licencias o claves estáticas
          options JSONB DEFAULT '[]',
          status VARCHAR(50) DEFAULT 'active',
          status_sys VARCHAR(50) DEFAULT 'system',
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          UNIQUE(category_uuid, name)
        );
      `);

      // 2.1 Tabla Product Components (Recetas / Conversiones) - NUEVA
      // Define qué ingredientes componen un producto o cuántas unidades tiene un paquete
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_components (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          parent_product_id UUID REFERENCES products(id) ON DELETE CASCADE, -- El producto final (ej. Hamburguesa)
          child_product_id UUID REFERENCES products(id), -- El ingrediente (ej. Carne)
          quantity_required NUMERIC(10, 4) NOT NULL -- Cuánto se necesita (ej. 1 pz o 0.150 kg)
        );
      `);

      // 3. Tabla Product Media 
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_media (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id UUID REFERENCES products(id) ON DELETE CASCADE,
          status VARCHAR(50) DEFAULT 'active',
          status_sys VARCHAR(50) DEFAULT 'system',
          name VARCHAR(255),
          description TEXT,
          typemedia VARCHAR(50) DEFAULT 'image',
          url TEXT NOT NULL,
          visible BOOLEAN DEFAULT TRUE,
          author VARCHAR(255),
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      // 4. Tabla Product Prices 
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_prices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id UUID REFERENCES products(id) ON DELETE CASCADE,
          status VARCHAR(50) DEFAULT 'active',
          status_sys VARCHAR(50) DEFAULT 'system',
          sku VARCHAR(100),
          internal_code VARCHAR(100),
          purchase_price NUMERIC(10, 2) DEFAULT 0,
          store_price NUMERIC(10, 2) DEFAULT 0,
          public_price NUMERIC(10, 2) NOT NULL, -- Precio principal de venta
          published_price NUMERIC(10, 2), -- Precio tachado/oferta
          stock_quantity NUMERIC(10, 4) DEFAULT 0, -- Ahora es decimal para soportar Kilos/Litros
          is_backorder BOOLEAN DEFAULT FALSE,
          type VARCHAR(50) DEFAULT 'physical', -- physical, digital
          min_stock_level INTEGER DEFAULT 5, -- Alerta MVP
          reorder_point INTEGER DEFAULT 10,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      // 5. Tabla Sessions 
      // Restricción única: type + custom_code + origin
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          type VARCHAR(50) NOT NULL,
          custom_code VARCHAR(100) NOT NULL,
          origin VARCHAR(100) NOT NULL,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          UNIQUE(type, custom_code, origin)
        );
      `);

      // 6. Tabla Cart Items 
      await client.query(`
        CREATE TABLE IF NOT EXISTS cart_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
          product_id UUID REFERENCES products(id) ON DELETE CASCADE,
          quantity INTEGER DEFAULT 1,
          options JSONB DEFAULT '[]',
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      // 7. Tabla Orders 
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID REFERENCES sessions(id),
          total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
          received_amount NUMERIC(10, 2) DEFAULT 0, -- Cantidad recibida (ej. pago con billete de 500)
          status VARCHAR(50) DEFAULT 'created', -- created, processing, completed, cancelled
          payment_status VARCHAR(50) DEFAULT 'pending', -- pending, paid, failed
          delivery_status VARCHAR(50) DEFAULT 'pending', -- pending, shipped, delivered
          payment_method VARCHAR(50), -- cash, card, stripe, etc.
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT, -- Fecha inicio
          completed_at BIGINT, -- Fecha fin
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      // 8. Tabla Order Items 
      await client.query(`
        CREATE TABLE IF NOT EXISTS order_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
          product_id UUID REFERENCES products(id),
          quantity INTEGER NOT NULL,
          options JSONB DEFAULT '[]',
          purchase_price NUMERIC(10, 2) DEFAULT 0,
          store_price NUMERIC(10, 2) DEFAULT 0,
          public_price NUMERIC(10, 2) DEFAULT 0,
          published_price NUMERIC(10, 2) DEFAULT 0,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      // 9. Tabla Ledger (Libro Contable - Entradas y Salidas)
      await client.query(`
        CREATE TABLE IF NOT EXISTS ledger (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID REFERENCES sessions(id),
          order_id UUID REFERENCES orders(id), -- Puede ser NULL si es un ajuste manual
          type VARCHAR(50) NOT NULL, -- 'income' (entrada), 'expense' (salida)
          concept VARCHAR(100) NOT NULL, -- 'sale', 'refund', 'adjustment'
          amount NUMERIC(10, 2) NOT NULL, -- Valor absoluto de la transacción
          description TEXT,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      // 10. Tabla Locations (Ubicaciones Físicas y Digitales) - NUEVA
      await client.query(`
        CREATE TABLE IF NOT EXISTS locations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL, -- Almacén Central, Tienda 1, Merma, Nube
          type VARCHAR(50) NOT NULL, -- warehouse, store, display, waste, digital, cedis
          address TEXT,
          is_virtual BOOLEAN DEFAULT FALSE,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
        -- Insertar ubicaciones base
        INSERT INTO locations (name, type, is_virtual) VALUES 
        ('Almacén General', 'warehouse', false),
        ('Tienda Principal', 'store', false),
        ('Exhibición', 'display', false),
        ('Mermas/Desperdicio', 'waste', false),
        ('Bóveda Digital', 'digital', true)
        ON CONFLICT DO NOTHING;
      `);

      // 11. Tabla Inventory Ledger (Libro de Inventario - Kardex) - NUEVA
      await client.query(`
        CREATE TABLE IF NOT EXISTS inventory_ledger (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id UUID REFERENCES products(id),
          location_id UUID REFERENCES locations(id),
          quantity NUMERIC(10, 4) NOT NULL, -- Positivo (entrada) o Negativo (salida)
          transaction_type VARCHAR(50) NOT NULL, -- purchase, sale, transfer, adjustment, production, conversion
          reference_id UUID, -- ID de orden, ID de transferencia, etc.
          notes TEXT,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        );
      `);

      await client.query('COMMIT');
      res.status(200).json({ 
        message: 'Migración completada. Sistema WMS (Inventarios Avanzados) configurado.',
        tables: ['categories', 'products', 'uoms', 'product_components', 'locations', 'inventory_ledger', 'orders', 'ledger']
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error en migración:', err);
    res.status(500).json({ error: 'Error al ejecutar migraciones', details: err.message });
  }
});

// ---------------------------------------------------------
// RUTA ESPECIAL: GET /menu (Reconstrucción del JSON)
// ---------------------------------------------------------
app.get('/menu', async (req, res) => {
  try {
    // Obtenemos todo y lo armamos en memoria para respetar la estructura anidada
    // 1. Categorías
    const catsRes = await pool.query('SELECT * FROM categories ORDER BY column_identifier, title');
    const categories = catsRes.rows;

    // 2. Productos con su precio público y su primera imagen visible
    const prodsRes = await pool.query(`
      SELECT 
        p.*,
        pp.public_price as price,
        pm.url as image
      FROM products p
      LEFT JOIN product_prices pp ON p.id = pp.product_id
      LEFT JOIN product_media pm ON p.id = pm.product_id AND pm.visible = true
      -- DISTINCT ON para traer solo una imagen si hay muchas, o filtrar en lógica
      ORDER BY p.created_at DESC
    `);
    const products = prodsRes.rows;

    // 3. Armar estructura: Columnas -> Categorías -> Items
    // Agrupar categorías por column_identifier
    const columnsMap = {};
    
    categories.forEach(cat => {
      if (!columnsMap[cat.column_identifier]) {
        columnsMap[cat.column_identifier] = {
          id: cat.column_identifier,
          categories: []
        };
      }

      // Filtrar productos de esta categoría
      // Nota: Usamos Set para evitar duplicados de imagen si el JOIN trajo múltiples
      const catProducts = products.filter(p => p.category_uuid === cat.id).filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

      columnsMap[cat.column_identifier].categories.push({
        id: cat.id,
        title: cat.title,
        headerImage: cat.header_image,
        items: catProducts
      });
    });

    res.json(Object.values(columnsMap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD: CATEGORIES
// ---------------------------------------------------------

// Obtener todas las categorías
app.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una categoría
app.post('/categories', async (req, res) => {
  const { column_identifier, title, header_image } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO categories (column_identifier, title, header_image) VALUES ($1, $2, $3) RETURNING *',
      [column_identifier, title, header_image]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar categoría
app.put('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { column_identifier, title, header_image } = req.body;
  try {
    const result = await pool.query(
      'UPDATE categories SET column_identifier = $1, title = $2, header_image = $3, updated_at = $4 WHERE id = $5 RETURNING *',
      [column_identifier, title, header_image, Date.now(), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar categoría
app.delete('/categories/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ message: 'Categoría eliminada', deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD: PRODUCTS
// ---------------------------------------------------------

// Obtener todos los productos (Vista plana con precio e imagen)
app.get('/products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, pp.public_price, pm.url as image_url 
      FROM products p
      LEFT JOIN product_prices pp ON p.id = pp.product_id
      LEFT JOIN product_media pm ON p.id = pm.product_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear un producto (Transacción Compleja: Producto + Precio + Media)
// Respeta la entrada estilo menu.json: { name, price, image, category_id, ... }
app.post('/products', async (req, res) => {
  const { category_id, name, description, detail, price, image, options, sku, stock, product_type, uom_id, digital_data } = req.body;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insertar Producto Base
    const prodRes = await client.query(
      `INSERT INTO products (category_uuid, name, description, detail, options, product_type, uom_id, digital_data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [category_id, name, description, detail, JSON.stringify(options || []), product_type || 'finished', uom_id, digital_data]
    );
    const newProduct = prodRes.rows[0];

    // 2. Insertar Precio (Inventario)
    await client.query(
      `INSERT INTO product_prices (product_id, public_price, sku, stock_quantity, type) 
       VALUES ($1, $2, $3, $4, $5)`,
      [newProduct.id, price || 0, sku || '', stock || 0, product_type === 'digital' ? 'digital' : 'physical']
    );

    // 3. Insertar Media (Imagen)
    if (image) {
      await client.query(
        `INSERT INTO product_media (product_id, url, typemedia, name) 
         VALUES ($1, $2, 'image', $3)`,
        [newProduct.id, image, name]
      );
    }

    await client.query('COMMIT');
    
    // Devolver objeto combinado
    res.status(201).json({
      ...newProduct,
      price: price,
      image: image
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Actualizar producto (Básico)
app.put('/products/:id', async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, detail, options } = req.body;
  try {
    const result = await pool.query(
      `UPDATE products SET category_uuid=$1, name=$2, description=$3, detail=$4, options=$5, updated_at=$6
       WHERE id=$7 RETURNING *`,
      [category_id, name, description, detail, JSON.stringify(options), Date.now(), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD: PRECIOS E INVENTARIO (Sub-recurso)
// ---------------------------------------------------------
app.get('/products/:id/prices', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM product_prices WHERE product_id = $1', [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------
// CRUD: MEDIA (Sub-recurso)
// ---------------------------------------------------------
app.get('/products/:id/media', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM product_media WHERE product_id = $1', [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------
// CRUD: INVENTARIOS AVANZADOS (WMS)
// ---------------------------------------------------------

// 1. Obtener Catálogos (UOMs y Ubicaciones)
app.get('/inventory/catalogs', async (req, res) => {
  try {
    const uoms = await pool.query('SELECT * FROM uoms');
    const locations = await pool.query('SELECT * FROM locations');
    res.json({ uoms: uoms.rows, locations: locations.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Registrar Movimiento de Inventario (Entrada/Salida/Transferencia)
// Este endpoint actualiza el Libro de Inventario y recalcula el stock total
app.post('/inventory/transaction', async (req, res) => {
  const { product_id, location_id, quantity, type, notes, to_location_id } = req.body;
  // type: 'purchase' (entrada), 'sale' (salida), 'waste' (salida), 'transfer' (movimiento), 'adjustment'
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validar producto
    const prodCheck = await client.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (prodCheck.rows.length === 0) throw new Error('Producto no encontrado');

    // Lógica según tipo
    if (type === 'transfer' && to_location_id) {
      // Salida de origen
      await client.query(`
        INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes)
        VALUES ($1, $2, $3, 'transfer_out', $4)
      `, [product_id, location_id, -Math.abs(quantity), `Transferencia a ${to_location_id}`]);
      
      // Entrada a destino
      await client.query(`
        INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes)
        VALUES ($1, $2, $3, 'transfer_in', $4)
      `, [product_id, to_location_id, Math.abs(quantity), `Transferencia desde ${location_id}`]);

    } else {
      // Movimiento simple (Compra, Venta, Merma)
      // Si es venta o merma, quantity debe ser negativo. Si es compra, positivo.
      // Aquí forzamos el signo según el tipo para facilitar la API
      let finalQty = parseFloat(quantity);
      if (['sale', 'waste', 'usage'].includes(type)) {
        finalQty = -Math.abs(finalQty);
      } else {
        finalQty = Math.abs(finalQty);
      }

      await client.query(`
        INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes)
        VALUES ($1, $2, $3, $4, $5)
      `, [product_id, location_id, finalQty, type, notes]);
    }

    // Actualizar el stock total cacheado en product_prices (Suma de todas las ubicaciones)
    // Nota: En un sistema real, podrías querer excluir ubicaciones como 'waste' o 'display' de la venta online.
    await client.query(`
      UPDATE product_prices 
      SET stock_quantity = (
        SELECT COALESCE(SUM(quantity), 0) FROM inventory_ledger WHERE product_id = $1
      )
      WHERE product_id = $1
    `, [product_id]);

    await client.query('COMMIT');
    res.json({ message: 'Movimiento de inventario registrado exitosamente.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 3. Conversión / Producción (Ej. Carne Paquete -> 8 Hamburguesas)
app.post('/inventory/convert', async (req, res) => {
  const { parent_product_id, quantity_to_produce, location_id } = req.body;
  // quantity_to_produce: Cuántas hamburguesas quiero hacer
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Obtener receta (ingredientes)
    const components = await client.query(
      'SELECT * FROM product_components WHERE parent_product_id = $1',
      [parent_product_id]
    );

    if (components.rows.length === 0) {
      // Si no tiene receta, tal vez es una conversión directa de UOM (Caja -> Unidades)
      // Por simplicidad, asumiremos que es una producción estándar.
      throw new Error('Este producto no tiene componentes definidos para producir.');
    }

    // 2. Descontar ingredientes (Raw Materials)
    for (const comp of components.rows) {
      const qtyNeeded = comp.quantity_required * quantity_to_produce;
      
      await client.query(`
        INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes)
        VALUES ($1, $2, $3, 'production_usage', $4)
      `, [comp.child_product_id, location_id, -qtyNeeded, `Uso para producir ${quantity_to_produce} de ${parent_product_id}`]);
      
      // Actualizar cache de ingrediente
      await client.query(`
        UPDATE product_prices SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM inventory_ledger WHERE product_id = $1) WHERE product_id = $1
      `, [comp.child_product_id]);
    }

    // 3. Incrementar producto terminado
    await client.query(`
      INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes)
      VALUES ($1, $2, $3, 'production_output', $4)
    `, [parent_product_id, location_id, quantity_to_produce, 'Producción finalizada']);

    // Actualizar cache de producto terminado
    await client.query(`
      UPDATE product_prices SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM inventory_ledger WHERE product_id = $1) WHERE product_id = $1
    `, [parent_product_id]);

    await client.query('COMMIT');
    res.json({ message: `Producción de ${quantity_to_produce} unidades completada.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 4. Consultar Stock Detallado por Ubicación
app.get('/inventory/stock/:product_id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        l.name as location_name,
        l.type as location_type,
        COALESCE(SUM(il.quantity), 0) as current_stock,
        u.abbreviation as uom
      FROM locations l
      LEFT JOIN inventory_ledger il ON l.id = il.location_id AND il.product_id = $1
      LEFT JOIN products p ON p.id = $1
      LEFT JOIN uoms u ON p.uom_id = u.id
      GROUP BY l.id, l.name, l.type, u.abbreviation
      HAVING COALESCE(SUM(il.quantity), 0) != 0
    `, [req.params.product_id]);
    
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------
// CRUD: SESSIONS (Gestión de Sesiones)
// ---------------------------------------------------------
app.post('/sessions', async (req, res) => {
  const { type, custom_code, origin } = req.body;
  try {
    // Intentamos insertar. Si existe conflicto (UNIQUE), actualizamos el updated_at y devolvemos el ID existente.
    const result = await pool.query(`
      INSERT INTO sessions (type, custom_code, origin)
      VALUES ($1, $2, $3)
      ON CONFLICT (type, custom_code, origin) 
      DO UPDATE SET updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
      RETURNING *
    `, [type, custom_code, origin]);
    
    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD: CART (Carrito Virtual)
// ---------------------------------------------------------

// Obtener carrito por ID de sesión
app.get('/cart/:session_id', async (req, res) => {
  const { session_id } = req.params;
  try {
    // Hacemos JOIN para traer detalles del producto (nombre, precio, imagen)
    // Usamos una subconsulta para la imagen para evitar duplicados si hay muchas imágenes
    const result = await pool.query(`
      SELECT 
        ci.id as cart_item_id,
        ci.quantity,
        ci.options,
        ci.created_at,
        p.id as product_id,
        p.name,
        p.description,
        pp.public_price as price,
        (SELECT url FROM product_media WHERE product_id = p.id LIMIT 1) as image
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_prices pp ON p.id = pp.product_id
      WHERE ci.session_id = $1
      ORDER BY ci.created_at DESC
    `, [session_id]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agregar item al carrito
app.post('/cart', async (req, res) => {
  const { session_id, product_id, quantity, options } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO cart_items (session_id, product_id, quantity, options)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [session_id, product_id, quantity || 1, JSON.stringify(options || [])]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar cantidad de un item del carrito
app.put('/cart/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;
  try {
    const result = await pool.query(`
      UPDATE cart_items 
      SET quantity = $1, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
      WHERE id = $2
      RETURNING *
    `, [quantity, id]);
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar item del carrito
app.delete('/cart/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM cart_items WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item no encontrado' });
    res.json({ message: 'Item eliminado', deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD: ORDERS (Creación y Consulta de Órdenes)
// ---------------------------------------------------------

// Crear Orden desde Carrito (Checkout)
app.post('/orders', async (req, res) => {
  const { session_id, payment_method, received_amount } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Obtener items del carrito con precios actuales (Snapshot)
    const cartRes = await client.query(`
      SELECT ci.*, pp.purchase_price, pp.store_price, pp.public_price, pp.published_price
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_prices pp ON p.id = pp.product_id
      WHERE ci.session_id = $1
    `, [session_id]);

    if (cartRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El carrito está vacío, no se puede crear la orden.' });
    }

    const items = cartRes.rows;
    
    // 2. Calcular total (usando public_price como base de venta)
    const totalAmount = items.reduce((sum, item) => {
      return sum + (parseFloat(item.public_price || 0) * item.quantity);
    }, 0);

    // 3. Crear la Orden
    const orderRes = await client.query(`
      INSERT INTO orders (session_id, total_amount, received_amount, payment_method, status, payment_status, created_at)
      VALUES ($1, $2, $3, $4, 'created', 'pending', $5)
      RETURNING *
    `, [session_id, totalAmount, received_amount || totalAmount, payment_method || 'cash', Date.now()]);
    
    const order = orderRes.rows[0];

    // 4. Insertar Items de la Orden (Copiando precios exactos del momento)
    for (const item of items) {
      await client.query(`
        INSERT INTO order_items (
          order_id, product_id, quantity, options, 
          purchase_price, store_price, public_price, published_price
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        order.id, 
        item.product_id, 
        item.quantity, 
        item.options,
        item.purchase_price || 0,
        item.store_price || 0,
        item.public_price || 0,
        item.published_price || 0
      ]);
    }

    // 5.1 Descontar Inventario (WMS)
    // Registramos la salida de mercancía del "Almacén General" o "Tienda" (hardcoded por ahora, idealmente dinámico)
    // Buscamos el ID de la ubicación 'store' o usamos una por defecto
    const locRes = await client.query("SELECT id FROM locations WHERE type='store' LIMIT 1");
    const storeLocationId = locRes.rows.length > 0 ? locRes.rows[0].id : null;

    if (storeLocationId) {
      for (const item of items) {
        await client.query(`
          INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, reference_id, notes)
          VALUES ($1, $2, $3, 'sale', $4, 'Salida por venta online')
        `, [item.product_id, storeLocationId, -item.quantity, order.id]);
        
        // Actualizar cache simple
        await client.query(`
          UPDATE product_prices SET stock_quantity = stock_quantity - $1 WHERE product_id = $2
        `, [item.quantity, item.product_id]);
      }
    }

    // 6. Registrar en Libro Contable (Ledger) - Entrada de Dinero
    await client.query(`
      INSERT INTO ledger (session_id, order_id, type, concept, amount, description)
      VALUES ($1, $2, 'income', 'sale', $3, $4)
    `, [session_id, order.id, totalAmount, `Venta Orden #${order.id.split('-')[0]}`]);

    // 5. Vaciar el carrito de la sesión
    await client.query('DELETE FROM cart_items WHERE session_id = $1', [session_id]);

    await client.query('COMMIT');
    
    res.status(201).json({ 
      message: 'Orden creada exitosamente', 
      order_id: order.id,
      total: totalAmount,
      status: order.status
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Obtener detalles de una Orden
app.get('/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    
    // Obtenemos los items con el nombre del producto y su imagen principal
    const itemsRes = await pool.query(`
      SELECT 
        oi.*, 
        p.name, 
        (SELECT url FROM product_media WHERE product_id = p.id LIMIT 1) as image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [id]);

    res.json({
      order: orderRes.rows[0],
      items: itemsRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// FINANZAS Y CONTABILIDAD
// ---------------------------------------------------------

// Obtener Balance de una Sesión (Resumen de cuenta)
app.get('/finance/balance/:session_id', async (req, res) => {
  const { session_id } = req.params;
  try {
    // Calculamos el total de entradas y salidas
    const result = await pool.query(`
      SELECT 
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense,
        (SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) - 
         SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)) as current_balance
      FROM ledger
      WHERE session_id = $1
    `, [session_id]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener Historial de Pagos/Transacciones (Paginado)
app.get('/finance/history/:session_id', async (req, res) => {
  const { session_id } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(`
      SELECT * FROM ledger 
      WHERE session_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `, [session_id, limit, offset]);

    const countRes = await pool.query('SELECT COUNT(*) FROM ledger WHERE session_id = $1', [session_id]);

    res.json({
      data: result.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count),
        page: page,
        limit: limit,
        pages: Math.ceil(parseInt(countRes.rows[0].count) / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar producto
app.delete('/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto eliminado', deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. RUTA DE ESTADO (Health Check)
// Esta es la ruta que solicitaste para informar el estatus.
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Servidor operando correctamente',
    service: 'Google Cloud API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Manejo de errores 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// 5. INICIO DEL SERVIDOR
// Google Cloud inyecta el puerto automáticamente en la variable PORT.
const PORT = process.env.PORT || 14420;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Acceso: https://localhost:${PORT}/`);
  });
}

module.exports = { app, pool };
