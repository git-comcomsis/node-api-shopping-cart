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
      await client.query('DROP TABLE IF EXISTS ledger, order_items, orders, cart_items, sessions, product_media, product_prices, products, categories CASCADE');

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

      // 2. Tabla Products
      await client.query(`
        CREATE TABLE IF NOT EXISTS products (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
          category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
          category_uuid UUID REFERENCES categories(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          detail TEXT,
          options JSONB DEFAULT '[]',
          status VARCHAR(50) DEFAULT 'active',
          status_sys VARCHAR(50) DEFAULT 'system',
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          UNIQUE(category_uuid, name)
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
          stock_quantity INTEGER DEFAULT 0,
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

      await client.query('COMMIT');
      res.status(200).json({ 
        message: 'Migración completada. Sistema Contable (Ledger) y Órdenes actualizado.',
        tables: ['categories', 'products', 'product_media', 'product_prices', 'sessions', 'cart_items', 'orders', 'order_items', 'ledger']
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
  const { category_id, name, description, detail, price, image, options, sku, stock } = req.body;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insertar Producto Base
    const prodRes = await client.query(
      `INSERT INTO products (category_uuid, name, description, detail, options) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [category_id, name, description, detail, JSON.stringify(options || [])]
    );
    const newProduct = prodRes.rows[0];

    // 2. Insertar Precio (Inventario)
    await client.query(
      `INSERT INTO product_prices (product_id, public_price, sku, stock_quantity) 
       VALUES ($1, $2, $3, $4)`,
      [newProduct.id, price || 0, sku || '', stock || 0]
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

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Acceso: https://localhost:${PORT}/`);
});
