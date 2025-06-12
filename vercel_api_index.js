// api/index.js - Vercel Serverless Function for CSV Wizard
const express = require('express');
const cors = require('cors');

const app = express();

// Enhanced CORS for Chrome extensions and production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow Chrome extensions, localhost, and Vercel domains
    if (!origin || 
        origin.startsWith('chrome-extension://') || 
        origin.startsWith('moz-extension://') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for now, restrict later if needed
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log('🏥 Health check requested');
  res.json({ 
    status: 'healthy', 
    message: 'CSV Wizard Backend is running on Vercel!',
    timestamp: new Date().toISOString(),
    environment: 'production',
    platform: 'vercel',
    version: '1.0.0',
    endpoints: ['/api/health', '/api/generate-api-key', '/api/user-info', '/api/complete-upload']
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  console.log('🧪 Test endpoint requested');
  res.json({ 
    message: 'Chrome extension connection successful!',
    backend: 'CSV Wizard Backend v1.0 on Vercel',
    timestamp: new Date().toISOString(),
    origin: req.headers.origin,
    platform: 'vercel-serverless'
  });
});

// Generate API key (mock for now, will integrate Supabase next)
app.post('/api/generate-api-key', (req, res) => {
  try {
    const { email, googleData } = req.body;
    console.log('🔑 API key generation requested for:', email);
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    const apiKey = 'csv_' + Math.random().toString(36).substring(2) + Date.now();
    const userId = 'user_' + Date.now();
    
    console.log('✅ Generated API key:', apiKey.substring(0, 10) + '...');
    
    res.json({
      success: true,
      apiKey: apiKey,
      userId: userId,
      platform: 'vercel'
    });
    
  } catch (error) {
    console.error('❌ API key generation failed:', error);
    res.status(500).json({
      error: 'Failed to generate API key',
      message: error.message
    });
  }
});

// User info
app.get('/api/user-info', (req, res) => {
  try {
    console.log('👤 User info requested');
    
    res.json({
      success: true,
      user: {
        userId: 'test_user',
        email: 'test@example.com',
        plan: 'free',
        memberSince: new Date().toISOString()
      },
      usage: {
        today: 0,
        limit: 5,
        remaining: 5,
        allowed: true
      },
      platform: 'vercel'
    });
  } catch (error) {
    console.error('❌ User info failed:', error);
    res.status(500).json({
      error: 'Failed to get user info',
      message: error.message
    });
  }
});

// Complete upload
app.post('/api/complete-upload', (req, res) => {
  try {
    const { csvContent, filename, spreadsheetId, sheetName } = req.body;
    
    console.log('🚀 Complete upload requested');
    console.log('  Filename:', filename);
    console.log('  Spreadsheet ID:', spreadsheetId);
    console.log('  CSV length:', csvContent?.length || 0);
    
    // Simulate processing (instant for serverless)
    res.json({
      success: true,
      processing: {
        rows: Math.floor(Math.random() * 1000) + 50,
        columns: Math.floor(Math.random() * 10) + 3,
        delimiter: ',',
        hasHeaders: true,
        quality: 0.95,
        processingTime: 125 // Faster on serverless!
      },
      upload: {
        success: true,
        spreadsheetId: spreadsheetId,
        sheetName: sheetName || 'Sheet1',
        rowsUploaded: Math.floor(Math.random() * 1000) + 50,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        method: 'append'
      },
      filename: filename,
      remainingUploads: 4,
      platform: 'vercel'
    });
    
  } catch (error) {
    console.error('❌ Upload failed:', error);
    res.status(500).json({
      success: false,
      error: 'Upload failed',
      message: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'CSV Wizard Backend',
    version: '1.0.0',
    status: 'running',
    platform: 'vercel-serverless',
    endpoints: {
      health: 'GET /api/health',
      test: 'GET /test',
      apiKey: 'POST /api/generate-api-key',
      userInfo: 'GET /api/user-info',
      upload: 'POST /api/complete-upload'
    }
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('💥 Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// 404 handler
app.use((req, res) => {
  console.log('❓ 404 - Not found:', req.path);
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    available: ['/api/health', '/test', '/api/generate-api-key', '/api/user-info', '/api/complete-upload']
  });
});

// Export for Vercel
module.exports = app;