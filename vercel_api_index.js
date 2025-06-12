// CSV Wizard Backend API - Vercel Compatible Version
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// ============================================
// MIDDLEWARE SETUP
// ============================================
app.use(cors({
    origin: ['chrome-extension://*', 'http://localhost:*', 'https://*'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============================================
// ROOT ROUTES (Handle both / and /api paths)
// ============================================

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'CSV Wizard Backend API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/api/health',
            generateApiKey: '/api/generate-api-key',
            userInfo: '/api/user-info',
            completeUpload: '/api/complete-upload'
        }
    });
});

// Test endpoint
app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Test endpoint working!',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        service: 'CSV Wizard Backend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Generate API key
app.post('/api/generate-api-key', (req, res) => {
    try {
        const { email, googleData } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }
        
        // Generate API key
        const apiKey = crypto.randomBytes(32).toString('hex');
        
        // TODO: Store in database (Supabase)
        console.log('API Key generated for:', email);
        
        res.json({
            success: true,
            apiKey: apiKey,
            message: 'API key generated successfully'
        });
        
    } catch (error) {
        console.error('Generate API key error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate API key'
        });
    }
});

// Get user info
app.get('/api/user-info', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authorization header required'
            });
        }
        
        // TODO: Validate API key with database
        
        // Mock user data for now
        res.json({
            success: true,
            user: {
                email: 'user@example.com',
                plan: 'free',
                createdAt: new Date().toISOString()
            },
            usage: {
                today: 2,
                limit: 5,
                remaining: 3
            }
        });
        
    } catch (error) {
        console.error('User info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user info'
        });
    }
});

// Complete upload to Google Sheets
app.post('/api/complete-upload', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authorization header required'
            });
        }
        
        const {
            csvContent,
            filename,
            spreadsheetId,
            sheetName,
            processingOptions,
            uploadOptions,
            googleToken
        } = req.body;
        
        if (!csvContent || !spreadsheetId || !googleToken) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: csvContent, spreadsheetId, googleToken'
            });
        }
        
        // TODO: Implement actual Google Sheets upload
        console.log('Processing upload:', {
            filename,
            spreadsheetId,
            csvLength: csvContent.length,
            sheetName
        });
        
        // Mock successful response
        const rowsUploaded = csvContent.split('\n').length - 1;
        
        res.json({
            success: true,
            message: 'Upload completed successfully',
            upload: {
                filename,
                spreadsheetId,
                sheetName: sheetName || 'Sheet1',
                rowsUploaded,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Upload failed: ' + error.message
        });
    }
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use('*', (req, res) => {
    console.log('404 - Route not found:', req.method, req.originalUrl);
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        availableRoutes: [
            'GET /',
            'GET /test', 
            'GET /api/health',
            'POST /api/generate-api-key',
            'GET /api/user-info',
            'POST /api/complete-upload'
        ]
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// ============================================
// EXPORT FOR VERCEL
// ============================================
module.exports = app;
