export default function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed - use GET'
        });
    }
    
    res.status(200).json({
        success: true,
        status: 'healthy',
        service: 'CSV Wizard Backend',
        version: '2.0.0',
        trialSystem: '🎯 7-day free trial active',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        endpoints: {
            health: '/api/health',
            generateApiKey: '/api/generate-api-key',
            userInfo: '/api/user-info',
            completeUpload: '/api/complete-upload',
            uploadCsv: '/api/upload-csv'
        },
        features: [
            '7-day free trial for all new users',
            'Unlimited uploads during trial',
            'Server-side CSV processing',
            'Google Sheets integration',
            'Secure API key authentication'
        ]
    });
}
