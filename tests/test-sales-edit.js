/**
 * Script de prueba para verificar endpoints de edición de ventas
 * Ejecutar con: node test-sales-edit.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

// Configura estos valores según tu aplicación
const TEST_CONFIG = {
  // Necesitas obtener un token de autenticación válido
  authToken: 'TU_TOKEN_AQUI', // ← Cambiar por un token real
  // ID de una venta existente en tu base de datos
  saleId: 'ID_VENTA_EXISTENTE', // ← Cambiar por un ID real
  // ID de un cliente existente
  clientId: 'ID_CLIENTE_EXISTENTE' // ← Cambiar por un ID real
};

const headers = {
  'Authorization': `Bearer ${TEST_CONFIG.authToken}`,
  'Content-Type': 'application/json',
  'X-User-ID': 'TU_USER_ID' // ← Si es necesario
};

async function testSalesAPI() {
  console.log('🧪 INICIANDO PRUEBAS DE API DE VENTAS\n');

  try {
    // PRUEBA 1: Obtener ventas existentes
    console.log('1️⃣ Obteniendo lista de ventas...');
    const salesResponse = await axios.get(`${BASE_URL}/api/sales`, { headers });
    console.log('✅ GET /api/sales - Status:', salesResponse.status);
    console.log('📊 Total ventas encontradas:', salesResponse.data.data.sales.length);
    
    if (salesResponse.data.data.sales.length > 0) {
      const firstSale = salesResponse.data.data.sales[0];
      console.log('📝 Primera venta ID:', firstSale.venta_id);
      console.log('💰 Total actual:', firstSale.total_venta);
      
      // Usar el ID de la primera venta para las pruebas
      TEST_CONFIG.saleId = firstSale.venta_id;
    }
    
  } catch (error) {
    console.log('❌ Error obteniendo ventas:', error.response?.data || error.message);
    return;
  }

  try {
    // PRUEBA 2: Obtener venta específica
    console.log('\n2️⃣ Obteniendo venta específica...');
    const saleResponse = await axios.get(`${BASE_URL}/api/sales/${TEST_CONFIG.saleId}`, { headers });
    console.log('✅ GET /api/sales/:id - Status:', saleResponse.status);
    const originalSale = saleResponse.data.data.sale;
    console.log('📋 Venta original:', {
      id: originalSale.venta_id,
      total: originalSale.total_venta,
      cliente: originalSale.Clientes?.nombre || 'Sin cliente'
    });

  } catch (error) {
    console.log('❌ Error obteniendo venta específica:', error.response?.data || error.message);
    return;
  }

  try {
    // PRUEBA 3: Editar venta (solo total)
    console.log('\n3️⃣ Editando venta (solo total)...');
    const newTotal = 123.45;
    const editResponse = await axios.put(`${BASE_URL}/api/sales/${TEST_CONFIG.saleId}`, {
      total_venta: newTotal
    }, { headers });
    
    console.log('✅ PUT /api/sales/:id - Status:', editResponse.status);
    console.log('💰 Nuevo total:', editResponse.data.data.sale.total_venta);
    console.log('📝 Mensaje:', editResponse.data.data.message);

  } catch (error) {
    console.log('❌ Error editando venta:', error.response?.data || error.message);
  }

  try {
    // PRUEBA 4: Editar venta (con notas)
    console.log('\n4️⃣ Editando venta (agregando notas)...');
    const editWithNotesResponse = await axios.put(`${BASE_URL}/api/sales/${TEST_CONFIG.saleId}`, {
      notas: 'Venta editada desde script de prueba - ' + new Date().toLocaleString()
    }, { headers });
    
    console.log('✅ PUT /api/sales/:id (notas) - Status:', editWithNotesResponse.status);
    console.log('📝 Notas agregadas:', editWithNotesResponse.data.data.sale.notas);

  } catch (error) {
    console.log('❌ Error agregando notas:', error.response?.data || error.message);
  }

  try {
    // PRUEBA 5: Intentar editar con datos inválidos
    console.log('\n5️⃣ Probando validaciones (total negativo)...');
    await axios.put(`${BASE_URL}/api/sales/${TEST_CONFIG.saleId}`, {
      total_venta: -100 // ← Esto debe fallar
    }, { headers });
    
    console.log('❌ ERROR: Debería haber rechazado total negativo');

  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Validación funcionando - rechazó total negativo');
      console.log('📝 Error esperado:', error.response.data.error);
    } else {
      console.log('❌ Error inesperado:', error.response?.data || error.message);
    }
  }

  try {
    // PRUEBA 6: Intentar editar venta inexistente
    console.log('\n6️⃣ Probando venta inexistente...');
    await axios.put(`${BASE_URL}/api/sales/00000000-0000-0000-0000-000000000000`, {
      total_venta: 100
    }, { headers });
    
    console.log('❌ ERROR: Debería haber rechazado venta inexistente');

  } catch (error) {
    if (error.response?.status === 404) {
      console.log('✅ Validación funcionando - rechazó venta inexistente');
    } else {
      console.log('❌ Error inesperado:', error.response?.data || error.message);
    }
  }

  console.log('\n🎉 PRUEBAS COMPLETADAS');
  console.log('\n📋 RESUMEN:');
  console.log('• Si todas las pruebas muestran ✅, el endpoint está funcionando');
  console.log('• Si alguna muestra ❌, revisa los errores específicos');
  console.log('• Verifica que los IDs de venta y cliente sean válidos');
}

// Función de ayuda para configurar el script
function showSetupInstructions() {
  console.log('🔧 CONFIGURACIÓN REQUERIDA:');
  console.log('');
  console.log('1. Obtén un token de autenticación:');
  console.log('   - Inicia sesión en tu frontend');
  console.log('   - Abre las herramientas de desarrollador (F12)');
  console.log('   - Ve a Network > Headers > Authorization');
  console.log('   - Copia el token');
  console.log('');
  console.log('2. Encuentra un ID de venta existente:');
  console.log('   - Ve a GET /api/sales en tu frontend');
  console.log('   - Copia un venta_id de la respuesta');
  console.log('');
  console.log('3. Actualiza las variables en TEST_CONFIG');
  console.log('');
  console.log('4. Ejecuta: node test-sales-edit.js');
}

// Verificar configuración
if (TEST_CONFIG.authToken === 'TU_TOKEN_AQUI') {
  showSetupInstructions();
} else {
  testSalesAPI();
}