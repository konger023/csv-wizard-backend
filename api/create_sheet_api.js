// API endpoint for creating new Google Spreadsheets
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
        
        // Verify API key and check trial status
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
        
        // Generate sheet name if not provided
        const finalSheetName = sheetName?.trim() || `CSV Import - ${new Date().toLocaleDateString()}`;
        
        console.log('✨ Creating new Google Spreadsheet:', finalSheetName);
        
        // Create new spreadsheet using Google Sheets API
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
            console.error('Google Sheets API error:', response.status, errorText);
            
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
        const { error: incrementError } = await supabase
            .rpc('increment_usage', { p_user_id: apiKeyData.user_id });
            
        if (incrementError) {
            console.error('Failed to increment usage:', incrementError);
            // Don't fail the request for usage tracking issues
        }
        
        // Log the activity
        const { error: logError } = await supabase
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
            
        if (logError) {
            console.error('Failed to log sheet creation:', logError);
            // Don't fail the request for logging issues
        }
        
        // Return updated trial status
        const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
        
        res.json({
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
        console.error('Create sheet error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create spreadsheet: ' + error.message
        });
    }
}