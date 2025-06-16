// API endpoint for getting sheet tabs within a Google Spreadsheet
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
    
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed - use POST'
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
        
        // Verify API key
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
        
        const { spreadsheetId, googleToken } = req.body;
        
        if (!spreadsheetId || !googleToken) {
            return res.status(400).json({
                success: false,
                error: 'Spreadsheet ID and Google token required'
            });
        }
        
        console.log('📄 Fetching sheet tabs for spreadsheet:', spreadsheetId);
        
        // Fetch sheet tabs using Google Sheets API
        const response = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title,index,gridProperties))`,
            {
                headers: {
                    'Authorization': `Bearer ${googleToken}`,
                    'Accept': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Google Sheets API error:', response.status, errorText);
            
            if (response.status === 401 || response.status === 403) {
                return res.status(401).json({
                    success: false,
                    error: 'Google authentication expired',
                    needsReauth: true
                });
            }
            
            if (response.status === 404) {
                return res.status(404).json({
                    success: false,
                    error: 'Spreadsheet not found or no access'
                });
            }
            
            throw new Error(`Google Sheets API error: ${response.status}`);
        }
        
        const data = await response.json();
        const sheets = data.sheets || [];
        
        console.log(`✅ Found ${sheets.length} tabs in spreadsheet`);
        
        // Format the tabs data for frontend
        const formattedTabs = sheets.map(sheet => ({
            id: sheet.properties.sheetId,
            title: sheet.properties.title,
            index: sheet.properties.index,
            rowCount: sheet.properties.gridProperties?.rowCount || 1000,
            columnCount: sheet.properties.gridProperties?.columnCount || 26,
            isDefault: sheet.properties.index === 0
        }));
        
        // Sort by index to maintain order
        formattedTabs.sort((a, b) => a.index - b.index);
        
        // Log the activity
        const { error: logError } = await supabase
            .from('csv_uploads')
            .insert({
                user_id: apiKeyData.user_id,
                filename: 'get-tabs-request',
                file_size: 0,
                status: 'info',
                rows_uploaded: 0,
                metadata: {
                    action: 'get_sheet_tabs',
                    spreadsheetId: spreadsheetId,
                    tabsFound: sheets.length,
                    tabNames: formattedTabs.map(t => t.title),
                    timestamp: new Date().toISOString()
                },
                created_at: new Date().toISOString()
            });
            
        if (logError) {
            console.error('Failed to log get tabs request:', logError);
            // Don't fail the request for logging issues
        }
        
        res.json({
            success: true,
            tabs: formattedTabs,
            spreadsheetId: spreadsheetId,
            total: formattedTabs.length,
            defaultTab: formattedTabs.find(t => t.isDefault)?.title || 'Sheet1',
            message: `Found ${formattedTabs.length} tabs`
        });
        
    } catch (error) {
        console.error('Get sheet tabs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sheet tabs: ' + error.message
        });
    }
}
