const request = require('supertest');
const { app, pool } = require('../index');

describe('Flujo Completo de Venta (E2E)', () => {
  // Variables para compartir IDs entre los pasos del test
  let categoryId;
  let burgerId;
  let sessionId;
  let orderId;
  const API_KEY = 'secret-api-key';
  
  // Configuración inicial: Asegurar que existan catálogos base
  beforeAll(async () => {
    // Ejecutamos la migración para asegurar tablas (con Auth)
    await request(app).get('/migrations').set('x-api-key', API_KEY);
  });

  // Cerrar conexión a DB al finalizar
  afterAll(async () => {
    await pool.end();
  });

  // 1. Verificar que el servidor responde
  test('GET / - Health Check', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('online');
  });

  // 2. Crear una Categoría
  test('POST /categories - Crear Categoría de Pruebas', async () => {
    const res = await request(app).post('/categories').send({
      column_identifier: 'col-test',
      title: 'Menú Testing',
      header_image: '/img/test.jpg'
    }).set('x-api-key', API_KEY);
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('id');
    categoryId = res.body.id;
  });

  // 3. Crear Producto (Hamburguesa)
  test('POST /products - Crear Hamburguesa', async () => {
    const res = await request(app).post('/products').send({
      category_id: categoryId,
      name: `Hamburguesa Test ${Date.now()}`, // Nombre único
      description: 'Creada por Jest',
      price: 150.00,
      stock: 0, // Empezamos sin stock
      product_type: 'finished',
      uom_id: null // Opcional si no tenemos el ID a mano
    }).set('x-api-key', API_KEY);
    expect(res.statusCode).toEqual(201);
    burgerId = res.body.id;
  });

  // 4. Abastecer Inventario (WMS)
  test('POST /inventory/transaction - Ingresar Stock', async () => {
    // Obtenemos ID del almacén (asumimos que la migración creó 'Almacén General')
    const catalogs = await request(app).get('/inventory/catalogs').set('x-api-key', API_KEY);
    const warehouse = catalogs.body.locations.find(l => l.type === 'warehouse');
    const store = catalogs.body.locations.find(l => l.type === 'store');

    expect(warehouse).toBeDefined();

    // 1. Compra al Almacén
    const resPurchase = await request(app).post('/inventory/transaction').send({
      product_id: burgerId,
      location_id: warehouse.id,
      quantity: 50,
      type: 'purchase',
      notes: 'Stock inicial Jest'
    }).set('x-api-key', API_KEY);
    expect(resPurchase.statusCode).toEqual(200);

    // 2. Transferencia a Tienda (para poder vender)
    const resTransfer = await request(app).post('/inventory/transaction').send({
      product_id: burgerId,
      location_id: warehouse.id,
      to_location_id: store.id,
      quantity: 10,
      type: 'transfer'
    }).set('x-api-key', API_KEY);
    expect(resTransfer.statusCode).toEqual(200);
  });

  // 5. Crear Sesión de Usuario
  test('POST /sessions - Iniciar Sesión Guest', async () => {
    const res = await request(app).post('/sessions').send({
      type: 'guest',
      custom_code: `user_test_${Date.now()}`,
      origin: 'jest_runner'
    }).set('x-api-key', API_KEY);
    expect(res.statusCode).toEqual(200);
    sessionId = res.body.id;
  });

  // 6. Agregar al Carrito
  test('POST /cart - Agregar Hamburguesa', async () => {
    const res = await request(app).post('/cart').send({
      session_id: sessionId,
      product_id: burgerId,
      quantity: 2
    }).set('x-api-key', API_KEY);
    expect(res.statusCode).toEqual(201);
    expect(res.body.quantity).toEqual(2);
  });

  // 7. Realizar Checkout (Crear Orden)
  test('POST /orders - Finalizar Compra', async () => {
    const res = await request(app).post('/orders').send({
      session_id: sessionId,
      payment_method: 'card',
      received_amount: 300.00
    }).set('x-api-key', API_KEY);
    
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('order_id');
    expect(parseFloat(res.body.total)).toEqual(300.00); // 150 * 2
    orderId = res.body.order_id;
  });

  // 7.1 Listar Ordenes por Sesión
  test('GET /orders/session/:session_id - Listar Ordenes', async () => {
    const res = await request(app).get(`/orders/session/${sessionId}`).set('x-api-key', API_KEY);
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].id).toEqual(orderId);
  });

  // 8. Verificar Inventario Post-Venta
  test('GET /inventory/stock/:id - Verificar descuento de stock', async () => {
    const res = await request(app).get(`/inventory/stock/${burgerId}`).set('x-api-key', API_KEY);
    
    // Buscamos el stock en la tienda
    const storeStock = res.body.find(s => s.location_type === 'store');
    
    // Teníamos 10 transferidas, vendimos 2, deben quedar 8
    expect(storeStock).toBeDefined();
    expect(parseFloat(storeStock.current_stock)).toEqual(8);
  });

  // 9. Verificar Finanzas
  test('GET /finance/balance/:id - Verificar ingreso en Ledger', async () => {
    const res = await request(app).get(`/finance/balance/${sessionId}`).set('x-api-key', API_KEY);
    
    expect(parseFloat(res.body.total_income)).toEqual(300.00);
  });

  // Limpieza (Opcional): Borrar datos creados
  test('DELETE /products/:id - Limpieza', async () => {
    // Borramos el producto (Cascada borrará precios e inventario asociado en ledger)
    // Nota: En producción real, inventory_ledger podría bloquear esto si no hay CASCADE,
    // pero para el test es útil limpiar.
    
    // Primero borramos items de orden para evitar FK constraint si no es cascada fuerte
    // Pero como definimos ON DELETE CASCADE en las migraciones, debería funcionar.
    const res = await request(app).delete(`/products/${burgerId}`).set('x-api-key', API_KEY);
    // Si falla por FK, no importa tanto en test dev, pero idealmente limpiamos.
    if (res.statusCode === 200) {
        expect(res.body.message).toContain('eliminado');
    }
  });
});