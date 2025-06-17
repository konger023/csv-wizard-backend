// FIXED: sheets-api.js - Backend Google Sheets API with proper token handling
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
        
        // Get action and Google token from request body
        const { action, googleToken } = req.body;
        
        if (!action) {
            return res.status(400).json({
                success: false,
                error: 'Action parameter required in request body'
            });
        }
        
        if (!googleToken) {
            return res.status(400).json({
                success: false,
                error: 'Google token required in request body'
            });
        }
        
        console.log(`📊 Sheets API - Action: ${action} for user: ${apiKeyData.user_email}`);
        
        switch (action) {
            case 'list-sheets':
                return await handleListSheets(req, res, apiKeyData, googleToken);
            case 'get-sheet-tabs':
                return await handleGetSheetTabs(req, res, apiKeyData, googleToken);
            case 'create-sheet':
                return await handleCreateSheet(req, res, apiKeyData, googleToken);
            case 'create-tab':
                return await handleCreateTab(req, res, apiKeyData, googleToken);
            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown action: ${action}. Available actions: list-sheets, get-sheet-tabs, create-sheet, create-tab`
                });
        }
        
    } catch (error) {
        console.error('Sheets API error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
}

// Handle list sheets
async function handleListSheets(req, res, apiKeyData, googleToken) {
    try {
        console.log('📊 Fetching Google Sheets for user:', apiKeyData.user_email);
        
        // First, test the Google token
        console.log('🧪 Testing Google token...');
        const tokenTestResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${googleToken}`,
                'Accept': 'application/json'
            }
        });
        
        if (!tokenTestResponse.ok) {
            console.error('❌ Google token test failed:', tokenTestResponse.status);
            return res.status(401).json({
                success: false,
                error: 'Google authentication expired',
                needsReauth: true
            });
        }
        
        const tokenInfo = await tokenTestResponse.json();
        console.log('✅ Google token valid for:', tokenInfo.email);
        
        // Fetch user's Google Sheets
        console.log('📊 Fetching Google Sheets from Drive API...');
        const response = await fetch(
            'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
                q: 'mimeType="application/vnd.google-apps.spreadsheet"',
                fields: 'files(id,name,modifiedTime,webViewLink,size,owners)',
                orderBy: 'modifiedTime desc',
                pageSize: '50'
            }),
            {
                headers: {
                    'Authorization': `Bearer ${googleToken}`,
                    'Accept': 'application/json'
                }
            }
        );
        
        console.log('📊 Google Drive API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Google Drive API error:', response.status, errorText);
            
            if (response.status === 401 || response.status === 403) {
                return res.status(401).json({
                    success: false,
                    error: 'Google authentication expired',
                    needsReauth: true
                });
            }
            
            throw new Error(`Google Drive API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        const sheets = data.files || [];
        
        console.log(`✅ Found ${sheets.length} Google Sheets`);
        
        // Format the sheets data
        const formattedSheets = sheets.map(sheet => {
            const modifiedDate = new Date(sheet.modifiedTime);
            const isRecent = (Date.now() - modifiedDate.getTime()) < (7 * 24 * 60 * 60 * 1000); // 7 days
            
            return {
                id: sheet.id,
                name: sheet.name,
                modifiedTime: sheet.modifiedTime,
                webViewLink: sheet.webViewLink,
                editUrl: `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`,
                size: sheet.size || 0,
                lastModified: modifiedDate.toLocaleDateString(),
                isRecent: isRecent,
                owner: sheet.owners?.[0]?.displayName || 'Unknown'
            };
        });
        
        // Sort by most recently modified first
        formattedSheets.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
        
        // Log the activity
        await logActivity(supabase, apiKeyData.user_id, 'list_sheets', {
            sheetsFound: sheets.length,
            userEmail: tokenInfo.email
        });
        
        return res.json({
            success: true,
            sheets: formattedSheets,
            total: formattedSheets.length,
            userEmail: tokenInfo.email,
            message: `Found ${formattedSheets.length} Google Sheets`
        });
        
    } catch (error) {
        console.error('❌ List sheets error:', error);
        
        // Check if it's an auth error
        if (error.message.includes('401') || error.message.includes('403')) {
            return res.status(401).json({
                success: false,
                error: 'Google authentication expired',
                needsReauth: true
            });
        }
        
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch sheets: ' + error.message
        });
    }
}

// Handle get sheet tabs
async function handleGetSheetTabs(req, res, apiKeyData, googleToken) {
    try {
        const { spreadsheetId } = req.body;
        
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                error: 'Spreadsheet ID required'
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
            console.error('Google Sheets API error:', response.status);
            
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
            
            const errorText = await response.text();
            throw new Error(`Google Sheets API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        const sheets = data.sheets || [];
        
        console.log(`✅ Found ${sheets.length} tabs in spreadsheet`);
        
        // Format the tabs data
        const formattedTabs = sheets.map(sheet => ({
            id: sheet.properties.sheetId,
            title: sheet.properties.title,
            index: sheet.properties.index,
            rowCount: sheet.properties.gridProperties?.rowCount || 1000,
            columnCount: sheet.properties.gridProperties?.columnCount || 26,
            isDefault: sheet.properties.index === 0
        }));
        
        // Sort by index
        formattedTabs.sort((a, b) => a.index - b.index);
        
        // Log the activity
        await logActivity(supabase, apiKeyData.user_id, 'get_sheet_tabs', {
            spreadsheetId: spreadsheetId,
            tabsFound: sheets.length,
            tabNames: formattedTabs.map(t => t.title)
        });
        
        return res.json({
            success: true,
            tabs: formattedTabs,
            spreadsheetId: spreadsheetId,
            total: formattedTabs.length,
            defaultTab: formattedTabs.find(t => t.isDefault)?.title || 'Sheet1',
            message: `Found ${formattedTabs.length} tabs`
        });
        
    } catch (error) {
        console.error('❌ Get sheet tabs error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get sheet tabs: ' + error.message
        });
    }
}

// Handle create sheet
async function handleCreateSheet(req, res, apiKeyData, googleToken) {
    try {
        // Check trial status first
        const { data: usage, error: usageError } = await supabase
            .from('user_usage')
            .select('*')
            .eq('user_id', apiKeyData.user_id)
            .single();
            
        if (
