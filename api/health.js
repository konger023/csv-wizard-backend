// Health check endpoint - save as /api/health.js in your Vercel backend

export default async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const healthData = {
            success: true,
            service: 'CSV Wizard Backend',
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        };
        
        console.log('✅ Health check successful');
        return res.status(200).json(healthData);
        
    } catch (error) {
        console.error('❌ Health check failed:', error);
        
        return res.status(500).json({
            success: false,
            service: 'CSV Wizard Backend',
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
