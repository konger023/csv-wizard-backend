// API endpoint for creating new tabs in existing Google Spreadsheets
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
        
        // First, check if tab already exists
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
        
        // Create new tab using Google Sheets API
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
            
            // Parse error for more specific messages
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error?.message?.includes('already exists')) {
                    return res.status(409).json({
                        success: false,
                        error: `Tab "${finalTabName}" already exists`
                    });
                }
            } catch (parseError) {
                // Ignore parse error, use generic message
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
        const { error: logError } = await supabase
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
            
        if (logError) {
            console.error('Failed to log tab creation:', logError);
            // Don't fail the request for logging issues
        }
        
        res.json({
            success: true,
            tab: tabData,
            message: `Successfully created tab "${finalTabName}"`,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        });
        
    } catch (error) {
        console.error('Create tab error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create tab: ' + error.message
        });
    }
}