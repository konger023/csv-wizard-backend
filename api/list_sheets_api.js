// API endpoint for listing user's Google Sheets
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
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
    
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authorization header required'
            });
        }
        
        const apiKey = authHeader.substring(7);
        
        // Verify API key and get user info
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .select('user_id, user_email')
            .eq('api_key', apiKey)
            .eq('is_active', true)
            .single();
        
        if (apiKeyError || !apiKeyData) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API key'
            });
        }
        
        // Get Google token from request body or query params
        const googleToken = req.query.token || req.body?.googleToken;
        
        if (!googleToken) {
            return res.status(400).json({
                success: false,
                error: 'Google token required'
            });
        }
        
        console.log('📊 Fetching Google Sheets for user:', apiKeyData.user_email);
        
        // Fetch user's Google Sheets using their token
        const response = await fetch(
            'https://www.googleapis.com/drive/v3/files?q=mimeType="application/vnd.google-apps.spreadsheet"&fields=files(id,name,modifiedTime,webViewLink,size)&orderBy=modifiedTime desc&pageSize=50',
            {
                headers: {
                    'Authorization': `Bearer ${googleToken}`,
                    'Accept': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Google API error:', response.status, errorText);
            
            if (response.status === 401 || response.status === 403) {
                return res.status(401).json({
                    success: false,
                    error: 'Google authentication expired',
                    needsReauth: true
                });
            }
            
            throw new Error(`Google API error: ${response.status}`);
        }
        
        const data = await response.json();
        const sheets = data.files || [];
        
        console.log(`✅ Found ${sheets.length} Google Sheets`);
        
        // Format the sheets data for frontend
        const formattedSheets = sheets.map(sheet => ({
            id: sheet.id,
            name: sheet.name,
            modifiedTime: sheet.modifiedTime,
            webViewLink: sheet.webViewLink,
            size: sheet.size || 0,
            lastModified: new Date(sheet.modifiedTime).toLocaleDateString(),
            editUrl: `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`
        }));
        
        // Log the activity
        const { error: logError } = await supabase
            .from('csv_uploads')
            .insert({
                user_id: apiKeyData.user_id,
                filename: 'list-sheets-request',
                file_size: 0,
                status: 'info',
                rows_uploaded: 0,
                metadata: {
                    action: 'list_sheets',
                    sheetsFound: sheets.length,
                    timestamp: new Date().toISOString()
                },
                created_at: new Date().toISOString()
            });
            
        if (logError) {
            console.error('Failed to log sheets list request:', logError);
            // Don't fail the request for logging issues
        }
        
        res.json({
            success: true,
            sheets: formattedSheets,
            total: formattedSheets.length,
            message: `Found ${formattedSheets.length} Google Sheets`
        });
        
    } catch (error) {
        console.error('List sheets error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sheets: ' + error.message
        });
    }
}