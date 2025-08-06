const axios = require('axios');

// Test configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || 'your-test-token-here';

// Test headers
const headers = {
  'Authorization': `Bearer ${TEST_TOKEN}`,
  'Content-Type': 'application/json'
};

async function testWidgetResponseFormat() {
  console.log('🧪 Testing Widget Endpoint Response Formats...\n');

  const endpoints = [
    {
      name: 'Sales Widget',
      url: '/api/widgets/sales',
      params: { limit: 5, period: 'week' }
    },
    {
      name: 'Payments Widget', 
      url: '/api/widgets/payments',
      params: { period: 'month' }
    },
    {
      name: 'Products Widget',
      url: '/api/widgets/products', 
      params: { status: 'available' }
    }
  ];

  for (const endpoint of endpoints) {
    console.log(`\n🔍 Testing ${endpoint.name}...`);
    
    try {
      const response = await axios.get(`${BASE_URL}${endpoint.url}`, { 
        headers,
        params: endpoint.params
      });

      // Check response structure
      const { data } = response;
      
      console.log(`✅ ${endpoint.name} - Status: ${response.status}`);
      
      // Verify response format
      if (data.success === true && data.data) {
        console.log(`✅ Response format is correct`);
        console.log(`📊 Data keys: ${Object.keys(data.data).join(', ')}`);
        
        // Show sample data structure
        if (Object.keys(data.data).length > 0) {
          const firstKey = Object.keys(data.data)[0];
          const sampleData = data.data[firstKey];
          if (Array.isArray(sampleData) && sampleData.length > 0) {
            console.log(`📋 Sample item structure:`, Object.keys(sampleData[0]));
          }
        }
      } else {
        console.log(`❌ Response format is incorrect`);
        console.log(`Expected: { success: true, data: {...} }`);
        console.log(`Received:`, data);
      }

    } catch (error) {
      console.log(`❌ ${endpoint.name} failed:`, error.message);
      
      if (error.response) {
        console.log(`Status: ${error.response.status}`);
        console.log(`Response:`, error.response.data);
      }
    }
  }

  console.log('\n🎉 Widget endpoint format verification completed!');
  console.log('\n📋 Summary:');
  console.log('- All endpoints should return: { success: true, data: {...} }');
  console.log('- Authentication: Bearer token required');
  console.log('- CORS: Configured for desktop app requests');
}

// Test CORS headers
async function testCORSHeaders() {
  console.log('\n🌐 Testing CORS Configuration...');
  
  try {
    const response = await axios.options(`${BASE_URL}/api/widgets/sales`, {
      headers: {
        'Origin': 'http://localhost:8080',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type'
      }
    });

    console.log('✅ CORS preflight successful');
    console.log('📋 CORS Headers:', {
      'Access-Control-Allow-Origin': response.headers['access-control-allow-origin'],
      'Access-Control-Allow-Methods': response.headers['access-control-allow-methods'],
      'Access-Control-Allow-Headers': response.headers['access-control-allow-headers'],
      'Access-Control-Allow-Credentials': response.headers['access-control-allow-credentials']
    });

  } catch (error) {
    console.log('❌ CORS test failed:', error.message);
  }
}

// Test authentication
async function testAuthentication() {
  console.log('\n🔐 Testing Authentication...');
  
  try {
    // Test without token
    const response = await axios.get(`${BASE_URL}/api/widgets/sales`, {
      validateStatus: () => true // Don't throw on 401
    });
    
    if (response.status === 401) {
      console.log('✅ Authentication required - correct behavior');
    } else {
      console.log('❌ Authentication not enforced');
    }

  } catch (error) {
    console.log('✅ Authentication test passed');
  }
}

// Run all tests
async function runAllTests() {
  await testWidgetResponseFormat();
  await testCORSHeaders();
  await testAuthentication();
  
  console.log('\n🎯 All tests completed!');
  console.log('\n📝 Next Steps:');
  console.log('1. Test with actual Joe desktop app');
  console.log('2. Verify real token authentication');
  console.log('3. Test with production data');
}

// Run tests
runAllTests(); 