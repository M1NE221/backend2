#!/usr/bin/env node

/**
 * Joe AI Backend Setup Test
 * Quick verification script to test backend components
 */

const fs = require('fs');
const path = require('path');

console.log('🤖 Joe AI Backend - Setup Test\n');

// Check required files
const requiredFiles = [
  'package.json',
  'server.js',
  'env.example',
  'config/database.js',
  'services/aiService.js',
  'middleware/auth.js',
  'middleware/errorHandler.js',
  'routes/conversation.js',
  'routes/sales.js',
  'routes/users.js',
  'routes/analytics.js',
  'utils/logger.js'
];

console.log('📁 Checking required files...');
let missingFiles = [];

requiredFiles.forEach(file => {
  if (fs.existsSync(path.join(__dirname, file))) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    missingFiles.push(file);
  }
});

if (missingFiles.length > 0) {
  console.log(`\n❌ Missing ${missingFiles.length} required files. Please ensure all files are created.`);
  process.exit(1);
}

// Check environment variables
console.log('\n🔧 Checking environment configuration...');

if (!fs.existsSync('.env')) {
  console.log('⚠️  .env file not found. Copy env.example to .env and configure your settings.');
} else {
  console.log('✅ .env file exists');
}

// Check package.json dependencies
console.log('\n📦 Checking package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const requiredDeps = [
    'express',
    'cors',
    'helmet',
    'winston',
    'dotenv',
    '@supabase/supabase-js',
    'openai',
    'uuid',
    'joi',
    'express-validator'
  ];

  const missing = requiredDeps.filter(dep => !packageJson.dependencies[dep]);
  if (missing.length > 0) {
    console.log(`❌ Missing dependencies: ${missing.join(', ')}`);
    console.log('Run: npm install');
  } else {
    console.log('✅ All required dependencies present');
  }
} catch (error) {
  console.log('❌ Error reading package.json:', error.message);
}

// Environment variables check
console.log('\n🔑 Environment Variables Checklist:');
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY', 
  'OPENAI_API_KEY'
];

console.log('Required for functionality:');
requiredEnvVars.forEach(envVar => {
  console.log(`   □ ${envVar}`);
});

console.log('\nOptional (with defaults):');
['NODE_ENV', 'PORT', 'OPENAI_MODEL', 'LOG_LEVEL'].forEach(envVar => {
  console.log(`   □ ${envVar}`);
});

// Basic syntax check
console.log('\n🔍 Basic syntax validation...');
try {
  require('./server.js');
  console.log('❌ Server started (this should not happen in test mode)');
  process.exit(1);
} catch (error) {
  if (error.message.includes('Missing required environment variables')) {
    console.log('✅ Server.js syntax OK (environment validation working)');
  } else if (error.code === 'MODULE_NOT_FOUND') {
    console.log(`❌ Missing module: ${error.message}`);
    console.log('Run: npm install');
  } else {
    console.log(`❌ Syntax error in server.js: ${error.message}`);
  }
}

console.log('\n🎯 Next Steps:');
console.log('1. Configure .env file with your API keys');
console.log('2. Run: npm install');
console.log('3. Run: npm run dev (for development)');
console.log('4. Test: curl http://localhost:3000/health');
console.log('5. Deploy: Connect to Railway and set environment variables');

console.log('\n📚 Documentation:');
console.log('- README.md for full setup instructions');
console.log('- env.example for environment variable template');
console.log('- API endpoints documented in README.md');

console.log('\n✨ Joe AI Backend setup verification complete!');

if (missingFiles.length === 0) {
  console.log('🚀 Ready for configuration and deployment!');
  process.exit(0);
} else {
  process.exit(1);
} 