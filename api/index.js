// api/index.js - Root endpoint
export default function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    res.status(200).json({
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
}
