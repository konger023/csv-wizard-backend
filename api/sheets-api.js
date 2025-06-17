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
            
        if (usageError || !usage) {
            return res.status(401).json({
                success: false,
                error: 'User usage data not found'
            });
        }
        
        const now = new Date();
        const trialEnd = new Date(usage.trial_ends_at);
        const isTrialActive = now <= trialEnd;
        
        if (!isTrialActive && usage.plan === 'trial') {
            return res.status(402).json({
                success: false,
                error: 'Trial expired',
                needsUpgrade: true,
                trialStatus: {
                    isExpired: true,
                    endDate: usage.trial_ends_at
                }
            });
        }
        
        const { sheetName } = req.body;
        const finalSheetName = sheetName?.trim() || `CSV Import - ${new Date().toLocaleDateString()}`;
        
        console.log('✨ Creating new Google Spreadsheet:', finalSheetName);
        
        // Create new spreadsheet
        const response = await fetch(
            'https://sheets.googleapis.com/v4/spreadsheets',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${googleToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    properties: {
                        title: finalSheetName
                    },
                    sheets: [{
                        properties: {
                            title: 'Sheet1',
                            gridProperties: {
                                rowCount: 1000,
                                columnCount: 26
                            }
                        }
                    }]
                })
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
            
            const errorText = await response.text();
            throw new Error(`Google Sheets API error: ${response.status} - ${errorText}`);
        }
        
        const newSpreadsheet = await response.json();
        
        console.log('✅ Spreadsheet created successfully:', newSpreadsheet.spreadsheetId);
        
        // Format response data
        const spreadsheetData = {
            id: newSpreadsheet.spreadsheetId,
            title: newSpreadsheet.properties.title,
            webViewLink: newSpreadsheet.spreadsheetUrl,
            editUrl: `https://docs.google.com/spreadsheets/d/${newSpreadsheet.spreadsheetId}/edit`,
            createdAt: new Date().toISOString(),
            defaultTab: 'Sheet1'
        };
        
        // Increment usage counter
        await supabase.rpc('increment_usage', { p_user_id: apiKeyData.user_id });
        
        // Log the activity
        await logActivity(supabase, apiKeyData.user_id, 'create_spreadsheet', {
            spreadsheetId: newSpreadsheet.spreadsheetId,
            sheetTitle: finalSheetName
        });
        
        // Return updated trial status
        const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
        
        return res.json({
            success: true,
            spreadsheet: spreadsheetData,
            message: `Successfully created "${finalSheetName}"`,
            trialStatus: {
                isActive: isTrialActive,
                daysRemaining: daysRemaining,
                uploadsRemaining: Math.max(0, (usage.uploads_today || 0))
            }
        });
        
    } catch (error) {
        console.error('❌ Create sheet error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create sheet: ' + error.message
        });
    }
}

// Handle create tab
async function handleCreateTab(req, res, apiKeyData, googleToken) {
    try {
        const { spreadsheetId, tabName } = req.body;
        
        if (!spreadsheetId || !tabName) {
            return res.status(400).json({
                success: false,
                error: 'Spreadsheet ID and tab name required'
            });
        }
        
        const finalTabName = tabName.trim();
        
        if (!finalTabName) {
            return res.status(400).json({
                success: false,
                error: 'Tab name cannot be empty'
            });
        }
        
        console.log('➕ Creating new tab:', finalTabName, 'in spreadsheet:', spreadsheetId);
        
        // Check if tab already exists
        const existingTabsResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`,
            {
                headers: {
                    'Authorization': `Bearer ${googleToken}`,
                    'Accept': 'application/json'
                }
            }
        );
        
        if (existingTabsResponse.ok) {
            const existingData = await existingTabsResponse.json();
            const existingTabs = existingData.sheets || [];
            
            const tabExists = existingTabs.some(sheet => 
                sheet.properties.title.toLowerCase() === finalTabName.toLowerCase()
            );
            
            if (tabExists) {
                return res.status(409).json({
                    success: false,
                    error: `Tab "${finalTabName}" already exists`,
                    existingTabs: existingTabs.map(s => s.properties.title)
                });
            }
        }
        
        // Create new tab
        const response = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${googleToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    requests: [{
                        addSheet: {
                            properties: {
                                title: finalTabName,
                                gridProperties: {
                                    rowCount: 1000,
                                    columnCount: 26
                                }
                            }
                        }
                    }]
                })
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
        
        const result = await response.json();
        const newSheet = result.replies[0].addSheet.properties;
        
        console.log('✅ Tab created successfully:', newSheet.title, 'ID:', newSheet.sheetId);
        
        // Format response data
        const tabData = {
            id: newSheet.sheetId,
            title: newSheet.title,
            index: newSheet.index,
            spreadsheetId: spreadsheetId,
            editUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${newSheet.sheetId}`,
            createdAt: new Date().toISOString()
        };
        
        // Log the activity
        await logActivity(supabase, apiKeyData.user_id, 'create_tab', {
            spreadsheetId: spreadsheetId,
            tabName: finalTabName,
            tabId: newSheet.sheetId
        });
        
        return res.json({
            success: true,
            tab: tabData,
            message: `Successfully created tab "${finalTabName}"`,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        });
        
    } catch (error) {
        console.error('❌ Create tab error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create tab: ' + error.message
        });
    }
}

// Helper function to log activities
async function logActivity(supabase, userId, action, metadata) {
    try {
        await supabase
            .from('csv_uploads')
            .insert({
                user_id: userId,
                filename: `${action}-request`,
                file_size: 0,
                status: 'info',
                rows_uploaded: 0,
                metadata: {
                    action: action,
                    ...metadata,
                    timestamp: new Date().toISOString()
                },
                created_at: new Date().toISOString()
            });
    } catch (error) {
        console.error('❌ Failed to log activity:', error);
        // Don't fail the main request if logging fails
    }
}
