// FIXED: sheets-api.js - Removed invalid supportsAllDrives from Sheets API calls
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
            case 'delete-sheet':
                return await handleDeleteSheet(req, res, apiKeyData, googleToken);
            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown action: ${action}. Available actions: list-sheets, get-sheet-tabs, create-sheet, create-tab, delete-sheet`
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

// Handle list sheets with shared drive support
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
        
        // Fetch user's Google Sheets with expanded search and shared drive support
        console.log('📊 Fetching Google Sheets from Drive API...');
        
        // Build comprehensive query parameters (Drive API supports supportsAllDrives)
        const queryParams = new URLSearchParams({
            q: 'mimeType="application/vnd.google-apps.spreadsheet"',
            fields: 'files(id,name,modifiedTime,webViewLink,size,owners,shared,driveId,parents)',
            orderBy: 'modifiedTime desc',
            pageSize: '100',
            supportsAllDrives: 'true', // This is OK for Drive API
            includeItemsFromAllDrives: 'true',
            corpora: 'allDrives'
        });
        
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?${queryParams}`,
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
        let sheets = data.files || [];
        
        console.log(`📊 Initial search found ${sheets.length} spreadsheets`);
        
        // If no sheets found, try alternative searches
        if (sheets.length === 0) {
            console.log('🔍 No sheets in initial search, trying alternative queries...');
            
            // Try searching without restrictions
            const alternativeParams = new URLSearchParams({
                q: 'mimeType="application/vnd.google-apps.spreadsheet"',
                fields: 'files(id,name,modifiedTime,webViewLink,size,owners)',
                pageSize: '50'
            });
            
            const altResponse = await fetch(
                `https://www.googleapis.com/drive/v3/files?${alternativeParams}`,
                {
                    headers: {
                        'Authorization': `Bearer ${googleToken}`,
                        'Accept': 'application/json'
                    }
                }
            );
            
            if (altResponse.ok) {
                const altData = await altResponse.json();
                const altSheets = altData.files || [];
                console.log(`📊 Alternative search found ${altSheets.length} spreadsheets`);
                sheets = altSheets;
            }
        }
        
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
                owner: sheet.owners?.[0]?.displayName || 'Unknown',
                isShared: sheet.shared || false,
                mimeType: sheet.mimeType || 'application/vnd.google-apps.spreadsheet'
            };
        });
        
        // Sort by most recently modified first
        formattedSheets.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
        
        console.log(`✅ Final result: ${formattedSheets.length} sheets found`);
        
        // Enhanced response with debug info
        const responseData = {
            success: true,
            sheets: formattedSheets,
            total: formattedSheets.length,
            userEmail: tokenInfo.email,
            message: formattedSheets.length > 0 
                ? `Found ${formattedSheets.length} Google Sheets`
                : 'No Google Sheets found. Try creating one in Google Drive first.',
            debug: {
                searchAttempts: sheets.length === 0 ? 'multiple' : 'initial',
                hasSharedDriveSupport: true,
                tokenValid: true
            }
        };
        
        // If still no sheets, provide helpful guidance
        if (formattedSheets.length === 0) {
            responseData.suggestions = [
                'Create a new Google Sheet in Google Drive',
                'Check if your sheets are in a Shared Drive (Team Drive)',
                'Ensure you have proper permissions to view the sheets',
                'Try refreshing the Google authentication in Settings'
            ];
        }
        
        // Log the activity
        await logActivity(supabase, apiKeyData.user_id, 'list_sheets', {
            sheetsFound: formattedSheets.length,
            userEmail: tokenInfo.email,
            searchSuccess: formattedSheets.length > 0
        });
        
        return res.json(responseData);
        
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
            error: 'Failed to fetch sheets: ' + error.message,
            suggestions: [
                'Check your Google authentication',
                'Ensure you have Google Sheets in your Drive',
                'Try creating a test sheet first'
            ]
        });
    }
}

// FIXED: Handle get sheet tabs - REMOVED supportsAllDrives parameter
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
        
        // FIXED: Removed supportsAllDrives parameter - this is for Sheets API, not Drive API
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

// Create sheet function
async function handleCreateSheet(req, res, apiKeyData, googleToken) {
    try {
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
            const errorText = await response.text();
            throw new Error(`Google Sheets API error: ${response.status} - ${errorText}`);
        }
        
        const newSpreadsheet = await response.json();
        
        return res.json({
            success: true,
            spreadsheet: {
                id: newSpreadsheet.spreadsheetId,
                title: newSpreadsheet.properties.title,
                editUrl: `https://docs.google.com/spreadsheets/d/${newSpreadsheet.spreadsheetId}/edit`,
                createdAt: new Date().toISOString()
            },
            message: `Successfully created "${finalSheetName}"`
        });
        
    } catch (error) {
        console.error('❌ Create sheet error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create sheet: ' + error.message
        });
    }
}

// Create tab function  
async function handleCreateTab(req, res, apiKeyData, googleToken) {
    try {
        const { spreadsheetId, tabName } = req.body;
        
        if (!spreadsheetId || !tabName) {
            return res.status(400).json({
                success: false,
                error: 'Spreadsheet ID and tab name required'
            });
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
                                title: tabName.trim(),
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
            const errorText = await response.text();
            throw new Error(`Google Sheets API error: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        const newSheet = result.replies[0].addSheet.properties;
        
        console.log(`✅ Successfully created new tab "${tabName.trim()}"`);
        
        return res.json({
            success: true,
            tab: {
                id: newSheet.sheetId,
                title: newSheet.title,
                spreadsheetId: spreadsheetId,
                editUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${newSheet.sheetId}`
            },
            message: `Successfully created tab "${newSheet.title}"`
        });
        
    } catch (error) {
        console.error('❌ Create tab error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create tab: ' + error.message
        });
    }
}

// Delete sheet function
async function handleDeleteSheet(req, res, apiKeyData, googleToken) {
    try {
        const { spreadsheetId, sheetId } = req.body;
        
        if (!spreadsheetId || sheetId === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Spreadsheet ID and sheet ID required'
            });
        }
        
        console.log(`🗑️ Deleting sheet ${sheetId} from spreadsheet ${spreadsheetId}`);
        
        // Delete sheet
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
                        deleteSheet: {
                            sheetId: parseInt(sheetId)
                        }
                    }]
                })
            }
        );
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google Sheets API error: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        
        console.log(`✅ Successfully deleted sheet ${sheetId}`);
        
        return res.json({
            success: true,
            message: `Successfully deleted sheet`
        });
        
    } catch (error) {
        console.error('❌ Delete sheet error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete sheet: ' + error.message
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
