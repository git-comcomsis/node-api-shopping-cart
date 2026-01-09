-- Script de Semilla (Seed) para Ejemplo Completo: Hamburguesa y Videojuego LiveToRun
-- Ejecutar en tu cliente SQL (pgAdmin, DBeaver) o mediante psql

DO $$
DECLARE
    -- Variables para almacenar los IDs generados dinámicamente
    v_cat_food_id UUID;
    v_cat_games_id UUID;
    v_uom_pz_id UUID;
    v_uom_kg_id UUID;
    v_uom_key_id UUID;
    v_loc_warehouse_id UUID;
    v_loc_store_id UUID;
    v_prod_meat_id UUID;
    v_prod_bun_id UUID;
    v_prod_burger_id UUID;
    v_prod_game_id UUID;
    v_session_id UUID;
    v_order_id UUID;
BEGIN

    -- ---------------------------------------------------------
    -- 1. CATALOGOS BASE (UOMs y Locations)
    -- ---------------------------------------------------------
    -- Insertamos una UOM específica si no existe (para cumplir con INSERT en tabla uoms)
    INSERT INTO uoms (name, abbreviation) VALUES ('Licencia Digital', 'key') ON CONFLICT DO NOTHING;
    
    -- Recuperamos IDs necesarios
    SELECT id INTO v_uom_pz_id FROM uoms WHERE abbreviation = 'pz' LIMIT 1;
    SELECT id INTO v_uom_kg_id FROM uoms WHERE abbreviation = 'kg' LIMIT 1;
    SELECT id INTO v_uom_key_id FROM uoms WHERE abbreviation = 'key' LIMIT 1;
    
    -- Insertamos una Ubicación extra (para cumplir con INSERT en tabla locations)
    INSERT INTO locations (name, type, is_virtual) VALUES ('Servidor de Descargas', 'digital', true) ON CONFLICT DO NOTHING;

    SELECT id INTO v_loc_warehouse_id FROM locations WHERE type = 'warehouse' LIMIT 1; -- Almacén General
    SELECT id INTO v_loc_store_id FROM locations WHERE type = 'store' LIMIT 1;         -- Tienda Principal

    -- ---------------------------------------------------------
    -- 2. CATEGORÍAS
    -- ---------------------------------------------------------
    INSERT INTO categories (column_identifier, title, header_image) 
    VALUES ('col-food', 'Alimentos Gourmet', '/images/food_bg.jpg') 
    RETURNING id INTO v_cat_food_id;

    INSERT INTO categories (column_identifier, title, header_image) 
    VALUES ('col-digital', 'Videojuegos', '/images/games_bg.jpg') 
    RETURNING id INTO v_cat_games_id;

    -- ---------------------------------------------------------
    -- 3. PRODUCTOS (Materia Prima, Terminado y Digital)
    -- ---------------------------------------------------------
    
    -- A) Ingredientes para la Hamburguesa
    INSERT INTO products (category_uuid, name, description, product_type, uom_id)
    VALUES (v_cat_food_id, 'Carne Sirloin Premium', 'Carne molida 90/10', 'raw_material', v_uom_kg_id)
    RETURNING id INTO v_prod_meat_id;

    INSERT INTO products (category_uuid, name, description, product_type, uom_id)
    VALUES (v_cat_food_id, 'Bollo Brioche', 'Pan artesanal con mantequilla', 'raw_material', v_uom_pz_id)
    RETURNING id INTO v_prod_bun_id;

    -- B) Producto Terminado: Hamburguesa
    INSERT INTO products (category_uuid, name, description, detail, product_type, uom_id)
    VALUES (v_cat_food_id, 'Hamburguesa Live', 'La favorita de los gamers', '150g Sirloin, Pan Brioche, Queso', 'finished', v_uom_pz_id)
    RETURNING id INTO v_prod_burger_id;

    -- C) Producto Digital: Videojuego
    INSERT INTO products (category_uuid, name, description, product_type, uom_id, digital_data)
    VALUES (v_cat_games_id, 'LiveToRun', 'Survival Horror Game - Edición Estándar', 'digital', v_uom_key_id, 'KEY-GEN-URL-LTR-2026')
    RETURNING id INTO v_prod_game_id;

    -- ---------------------------------------------------------
    -- 4. RECETA (Product Components)
    -- ---------------------------------------------------------
    -- La hamburguesa consume 0.150 KG de carne y 1 Pan
    INSERT INTO product_components (parent_product_id, child_product_id, quantity_required) VALUES (v_prod_burger_id, v_prod_meat_id, 0.150);
    INSERT INTO product_components (parent_product_id, child_product_id, quantity_required) VALUES (v_prod_burger_id, v_prod_bun_id, 1);

    -- ---------------------------------------------------------
    -- 5. PRECIOS Y MEDIA
    -- ---------------------------------------------------------
    INSERT INTO product_media (product_id, url, name) VALUES (v_prod_burger_id, '/images/burger.jpg', 'Vista Principal');
    INSERT INTO product_media (product_id, url, name) VALUES (v_prod_game_id, '/images/livetorun.jpg', 'Portada');

    -- Precios e Inventario Inicial Cacheado (0 al inicio)
    INSERT INTO product_prices (product_id, public_price, sku, stock_quantity, type) VALUES (v_prod_meat_id, 0, 'RAW-MEAT', 0, 'physical');
    INSERT INTO product_prices (product_id, public_price, sku, stock_quantity, type) VALUES (v_prod_bun_id, 0, 'RAW-BUN', 0, 'physical');
    INSERT INTO product_prices (product_id, public_price, sku, stock_quantity, type) VALUES (v_prod_burger_id, 180.00, 'BURGER-LIVE', 0, 'physical');
    INSERT INTO product_prices (product_id, public_price, sku, stock_quantity, type) VALUES (v_prod_game_id, 1200.00, 'GAME-LTR', 9999, 'digital');

    -- ---------------------------------------------------------
    -- 6. WMS: ABASTECIMIENTO Y PRODUCCIÓN
    -- ---------------------------------------------------------
    -- Compra de Insumos (Entrada al Almacén)
    INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes) VALUES (v_prod_meat_id, v_loc_warehouse_id, 10, 'purchase', 'Compra 10kg Carne');
    INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes) VALUES (v_prod_bun_id, v_loc_warehouse_id, 50, 'purchase', 'Compra 50 Panes');

    -- Producción de 10 Hamburguesas (Transformación: Salen insumos, Entra producto final)
    -- Salida de insumos
    INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes) VALUES (v_prod_meat_id, v_loc_warehouse_id, -1.5, 'production_usage', 'Prod 10 burgers');
    INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes) VALUES (v_prod_bun_id, v_loc_warehouse_id, -10, 'production_usage', 'Prod 10 burgers');
    -- Entrada de producto terminado a Tienda
    INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, notes) VALUES (v_prod_burger_id, v_loc_store_id, 10, 'production_output', 'Lote #1');

    -- Actualizar cache de precios (Simplificado para el ejemplo)
    UPDATE product_prices SET stock_quantity = 10 WHERE product_id = v_prod_burger_id;

    -- ---------------------------------------------------------
    -- 7. SIMULACIÓN DE VENTA (Carrito -> Orden)
    -- ---------------------------------------------------------
    -- Crear Sesión
    INSERT INTO sessions (type, custom_code, origin) 
    VALUES ('guest', 'gamer_client_01', 'web') 
    RETURNING id INTO v_session_id;

    -- Llenar Carrito (Histórico)
    INSERT INTO cart_items (session_id, product_id, quantity) VALUES (v_session_id, v_prod_burger_id, 2);
    INSERT INTO cart_items (session_id, product_id, quantity) VALUES (v_session_id, v_prod_game_id, 1);

    -- Crear Orden (Checkout)
    INSERT INTO orders (session_id, total_amount, received_amount, payment_method, status)
    VALUES (v_session_id, (180.00 * 2) + 1200.00, 1600.00, 'card', 'completed')
    RETURNING id INTO v_order_id;

    -- Items de la Orden
    INSERT INTO order_items (order_id, product_id, quantity, public_price) VALUES (v_order_id, v_prod_burger_id, 2, 180.00);
    INSERT INTO order_items (order_id, product_id, quantity, public_price) VALUES (v_order_id, v_prod_game_id, 1, 1200.00);

    -- ---------------------------------------------------------
    -- 8. POST-VENTA (Inventario y Finanzas)
    -- ---------------------------------------------------------
    -- Descontar Hamburguesas de la Tienda
    INSERT INTO inventory_ledger (product_id, location_id, quantity, transaction_type, reference_id, notes)
    VALUES (v_prod_burger_id, v_loc_store_id, -2, 'sale', v_order_id, 'Venta Online #1');

    UPDATE product_prices SET stock_quantity = 8 WHERE product_id = v_prod_burger_id;

    -- Registrar Ingreso en Libro Contable
    INSERT INTO ledger (session_id, order_id, type, concept, amount, description)
    VALUES (v_session_id, v_order_id, 'income', 'sale', 1560.00, 'Venta LiveToRun + Burgers');

    -- Limpiar carrito
    DELETE FROM cart_items WHERE session_id = v_session_id;

END $$;
