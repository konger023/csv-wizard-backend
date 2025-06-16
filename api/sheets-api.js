// Combined Sheets API - Handles all Google Sheets operations
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
        
        // Route based on action parameter
        const action = req.query.action || req.body?.action;
        
        if (!action) {
            return res.status(400).json({
                success: false,
                error: 'Action parameter required'
            });
        }
        
        console.log(`📊 Sheets API - Action: ${action} for user: ${apiKeyData.user_email}`);
        
        switch (action) {
            case 'list-sheets':
                return await handleListSheets(req, res, apiKeyData);
            case 'get-sheet-tabs':
                return await handleGetSheetTabs(req, res, apiKeyData);
            case 'create-sheet':
                return await handleCreateSheet(req, res, apiKeyData);
            case 'create-tab':
                return await handleCreateTab(req, res, apiKeyData);
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
async function handleListSheets(req, res, apiKeyData) {
    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Use GET for list-sheets'
        });
    }
    
    const googleToken = req.query.token;
    
    if (!googleToken) {
        return res.status(400).json({
            success: false,
            error: 'Google token required'
        });
    }
    
    console.log('📊 Fetching Google Sheets for user:', apiKeyData.user_email);
    
    // Fetch user's Google Sheets
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
        console.error('Google API error:', response.status);
        
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
    
    // Format the sheets data
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
    await supabase
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
    
    return res.json({
        success: true,
        sheets: formattedSheets,
        total: formattedSheets.length,
        message: `Found ${formattedSheets.length} Google Sheets`
    });
}

// Handle get sheet tabs
async function handleGetSheetTabs(req, res, apiKeyData) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Use POST for get-sheet-tabs'
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
    
    // Fetch sheet tabs
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
        
        throw new Error(`Google Sheets API error: ${response.status}`);
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
    await supabase
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
    
    return res.json({
        success: true,
        tabs: formattedTabs,
        spreadsheetId: spreadsheetId,
        total: formattedTabs.length,
        defaultTab: formattedTabs.find(t => t.isDefault)?.title || 'Sheet1',
        message: `Found ${formattedTabs.length} tabs`
    });
}

// Handle create sheet
async function handleCreateSheet(req, res, apiKeyData) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Use POST for create-sheet'
        });
    }
    
    // Check trial status
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
    
    const { sheetName, googleToken } = req.body;
    
    if (!googleToken) {
        return res.status(400).json({
            success: false,
            error: 'Google token required'
        });
    }
    
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
        
        throw new Error(`Google Sheets API error: ${response.status}`);
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
    await supabase
        .from('csv_uploads')
        .insert({
            user_id: apiKeyData.user_id,
            filename: 'create-sheet-request',
            file_size: 0,
            sheet_name: finalSheetName,
            sheet_url: spreadsheetData.editUrl,
            upload_type: 'create_new',
            status: 'success',
            rows_uploaded: 0,
            metadata: {
                action: 'create_spreadsheet',
                spreadsheetId: newSpreadsheet.spreadsheetId,
                sheetTitle: finalSheetName,
                timestamp: new Date().toISOString()
            },
            created_at: new Date().toISOString()
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
}

// Handle create tab
async function handleCreateTab(req, res, apiKeyData) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Use POST for create-tab'
        });
    }
    
    const { spreadsheetId, tabName, googleToken } = req.body;
    
    if (!spreadsheetId || !tabName || !googleToken) {
        return res.status(400).json({
            success: false,
            error: 'Spreadsheet ID, tab name, and Google token required'
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
        
        throw new Error(`Google Sheets API error: ${response.status}`);
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
    await supabase
        .from('csv_uploads')
        .insert({
            user_id: apiKeyData.user_id,
            filename: 'create-tab-request',
            file_size: 0,
            sheet_name: finalTabName,
            sheet_url: tabData.editUrl,
            upload_type: 'create_tab',
            status: 'success',
            rows_uploaded: 0,
            metadata: {
                action: 'create_tab',
                spreadsheetId: spreadsheetId,
                tabName: finalTabName,
                tabId: newSheet.sheetId,
                timestamp: new Date().toISOString()
            },
            created_at: new Date().toISOString()
        });
    
    return res.json({
        success: true,
        tab: tabData,
        message: `Successfully created tab "${finalTabName}"`,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    });
}
