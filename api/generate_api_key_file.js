import crypto from 'crypto';

export default function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed - use POST'
        });
    }
    
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
        
        // TODO: Store in database (Supabase) later
        console.log('API Key generated for:', email);
        
        res.status(200).json({
            success: true,
            apiKey: apiKey,
            message: 'API key generated successfully',
            user: {
                email,
                plan: 'free',
                createdAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Generate API key error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate API key'
        });
    }
}