const { AIService } = require('./services/aiService');
const { dbHelpers } = require('./config/database');

async function testEnhancedPricing() {
  console.log('🧪 Testing Enhanced Product Auto-Creation with Price Tracking...\n');

  const aiService = new AIService();
  const testUserId = 'test-user-id'; // Replace with actual test user ID

  try {
    // Test 1: Auto-create product with price
    console.log('1️⃣ Testing auto-create product with price...');
    const productId1 = await aiService.autoCreateProduct(
      testUserId, 
      'Test Product 1', 
      150.50
    );
    console.log('✅ Auto-created product:', productId1);

    // Test 2: Get current price
    console.log('\n2️⃣ Testing get current price...');
    const currentPrice = await dbHelpers.getCurrentPrice(productId1);
    console.log('✅ Current price:', currentPrice);

    // Test 3: Update product price
    console.log('\n3️⃣ Testing price update...');
    const updateSuccess = await aiService.updateProductPrice(productId1, 175.00);
    console.log('✅ Price update success:', updateSuccess);

    // Test 4: Get price history
    console.log('\n4️⃣ Testing price history...');
    const priceHistory = await dbHelpers.getPriceHistory(productId1);
    console.log('✅ Price history:', priceHistory);

    // Test 5: Process sale with pricing for existing product
    console.log('\n5️⃣ Testing sale processing with existing product...');
    const saleId = 'test-sale-id';
    const processedProductId = await aiService.processSaleWithPricing(
      testUserId,
      'Test Product 1',
      175.00,
      2,
      saleId
    );
    console.log('✅ Processed sale with existing product:', processedProductId);

    // Test 6: Process sale with pricing for new product
    console.log('\n6️⃣ Testing sale processing with new product...');
    const newProductId = await aiService.processSaleWithPricing(
      testUserId,
      'Test Product 2',
      200.00,
      1,
      saleId
    );
    console.log('✅ Processed sale with new product:', newProductId);

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 Summary:');
    console.log('- Product auto-creation with price tracking: ✅');
    console.log('- Price history management: ✅');
    console.log('- Sale processing with enhanced pricing: ✅');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testEnhancedPricing(); 