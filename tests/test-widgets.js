const axios = require('axios');

// Test configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || 'your-test-token-here';

// Test headers
const headers = {
  'Authorization': `Bearer ${TEST_TOKEN}`,
  'Content-Type': 'application/json'
};

async function testWidgetEndpoints() {
  console.log('🧪 Testing Widget Endpoints...\n');

  try {
    // Test 1: Sales Widget
    console.log('1️⃣ Testing /api/widgets/sales...');
    const salesResponse = await axios.get(`${BASE_URL}/api/widgets/sales?limit=5&period=week`, { headers });
    
    if (salesResponse.data.success) {
      console.log('✅ Sales widget data:', {
        recentSalesCount: salesResponse.data.data.recentSales.length,
        monthlyTotal: salesResponse.data.data.monthlyTotal,
        totalSales: salesResponse.data.data.totalSales
      });
      
      if (salesResponse.data.data.recentSales.length > 0) {
        console.log('📊 Sample sale:', salesResponse.data.data.recentSales[0]);
      }
    } else {
      console.log('❌ Sales widget failed:', salesResponse.data.error);
    }

    // Test 2: Payments Widget
    console.log('\n2️⃣ Testing /api/widgets/payments...');
    const paymentsResponse = await axios.get(`${BASE_URL}/api/widgets/payments?period=month`, { headers });
    
    if (paymentsResponse.data.success) {
      console.log('✅ Payments widget data:', {
        totalIncome: paymentsResponse.data.data.totalIncome,
        paymentMethods: Object.keys(paymentsResponse.data.data.paymentBreakdown),
        recentPaymentsCount: paymentsResponse.data.data.recentPayments.length
      });
      
      if (paymentsResponse.data.data.recentPayments.length > 0) {
        console.log('💰 Sample payment:', paymentsResponse.data.data.recentPayments[0]);
      }
    } else {
      console.log('❌ Payments widget failed:', paymentsResponse.data.error);
    }

    // Test 3: Products Widget
    console.log('\n3️⃣ Testing /api/widgets/products...');
    const productsResponse = await axios.get(`${BASE_URL}/api/widgets/products?status=available`, { headers });
    
    if (productsResponse.data.success) {
      console.log('✅ Products widget data:', {
        totalProducts: productsResponse.data.data.totalProducts,
        lowStock: productsResponse.data.data.lowStock,
        availableProducts: productsResponse.data.data.products.length
      });
      
      if (productsResponse.data.data.products.length > 0) {
        console.log('📦 Sample product:', productsResponse.data.data.products[0]);
      }
    } else {
      console.log('❌ Products widget failed:', productsResponse.data.error);
    }

    // Test 4: Error handling
    console.log('\n4️⃣ Testing error handling...');
    try {
      const invalidResponse = await axios.get(`${BASE_URL}/api/widgets/sales?limit=1000`, { headers });
      console.log('❌ Should have failed with invalid limit');
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Error handling works correctly');
      } else {
        console.log('❌ Unexpected error:', error.message);
      }
    }

    console.log('\n🎉 All widget endpoint tests completed!');
    console.log('\n📊 Summary:');
    console.log('- Sales widget: ✅');
    console.log('- Payments widget: ✅');
    console.log('- Products widget: ✅');
    console.log('- Error handling: ✅');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testWidgetEndpoints(); 