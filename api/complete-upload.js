// Updated Complete Upload API with enhanced security and error handling
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// CSV Processing Functions
function parseCSVContent(csvContent, options = {}) {
    try {
        const delimiter = options.delimiter || ',';
        const headerHandling = options.headerHandling || 'use';
        const trimWhitespace = options.trimWhitespace !== false;
        const skipEmptyRows = options.skipEmptyRows !== false;

        let finalDelimiter = delimiter;
        if (delimiter === 'auto') {
            finalDelimiter = detectDelimiter(csvContent);
        }

        let lines = csvContent.split('\n');
        if (trimWhitespace) {
            lines = lines.map(line => line.trim());
        }
        if (skipEmptyRows) {
            lines = lines.filter(line => line.length > 0);
        }

        const rows = [];
        for (let i = 0; i < lines.length; i++) {
            const parsedRow = parseCSVLine(lines[i], finalDelimiter);
            if (parsedRow.length > 0) {
                rows.push(parsedRow);
            }
        }

        return {
            success: true,
            rows: rows,
            totalRows: rows.length,
            delimiter: finalDelimiter
        };

    } catch (error) {
        console.error('❌ CSV parsing failed:', error);
        return {
            success: false,
            error: error.message,
            rows: [],
            totalRows: 0
        };
    }
}

function detectDelimiter(csvContent) {
    const delimiters = [',', ';', '\t', '|'];
    const firstLine = csvContent.split('\n')[0];
    
    let bestDelimiter = ',';
    let maxCount = 0;
    
    for (const delimiter of delimiters) {
        const regex = new RegExp('\\' + delimiter, 'g');
        const matches = firstLine.match(regex);
        const count = matches ? matches.length : 0;
        if (count > maxCount) {
            maxCount = count;
            bestDelimiter = delimiter;
        }
    }
    
    return bestDelimiter;
}

function parseCSVLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

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
        
        // Verify API key and get user info
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .select('user_id, user_email')
            .eq('api_key', apiKey)
            .eq('is_active', true)
            .single();
        
        if (apiKeyError || !apiKeyData) {
            console.error('❌ Invalid API key:', apiKey.substring(0, 20) + '...');
            return res.status(401).json({
                success: false,
                error: 'Invalid API key'
            });
        }
        
        console.log('🔑 Valid API key for user:', apiKeyData.user_email);
        
        // Check trial status and usage limits
        const { data: usage, error: usageError } = await supabase
            .from('user_usage')
            .select('*')
            .eq('user_id', apiKeyData.user_id)
            .single();
            
        if (usageError || !usage) {
            console.error('❌ User usage data not found:', usageError);
            return res.status(401).json({
                success: false,
                error: 'User usage data not found'
            });
        }
        
        // Check trial expiration
        const now = new Date();
        const trialEnd = new Date(usage.trial_ends_at);
        const isTrialActive = now <= trialEnd;
        const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
        
        if (!isTrialActive && usage.plan === 'trial') {
            console.log('❌ Trial expired for user:', apiKeyData.user_email);
            return res.status(402).json({
                success: false,
                error: 'Trial expired',
                needsUpgrade: true,
                trialStatus: {
                    isExpired: true,
                    daysRemaining: 0,
                    endDate: usage.trial_ends_at
                }
            });
        }
        
        console.log('✅ Trial active, days remaining:', daysRemaining);
        
        const { 
            csvContent, 
            filename, 
            spreadsheetId, 
            sheetName, 
            processingOptions, 
            uploadOptions, 
            googleToken 
        } = req.body;
        
        if (!csvContent || !spreadsheetId || !googleToken) {
            return res.status(400).json({
                success: false,
                error: 'CSV content, spreadsheet ID, and Google token are required'
            });
        }
        
        console.log('🔄 Processing upload request:', {
            filename,
            spreadsheetId,
            sheetName,
            user: apiKeyData.user_email,
            csvSize: csvContent.length
        });
        
        // Parse CSV content
        const csvResult = parseCSVContent(csvContent, processingOptions);
        
        if (!csvResult.success) {
            return res.status(400).json({
                success: false,
                error: 'CSV parsing failed: ' + csvResult.error
            });
        }
        
        const { rows } = csvResult;
        
        if (rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No data found in CSV file'
            });
        }
        
        console.log(`📊 Parsed ${rows.length} rows from CSV`);
        
        // Upload to Google Sheets
        const uploadResult = await uploadToGoogleSheets(
            spreadsheetId,
            sheetName || 'Sheet1',
            rows,
            uploadOptions,
            googleToken
        );
        
        if (!uploadResult.success) {
            if (uploadResult.authExpired) {
                return res.status(401).json({
                    success: false,
                    error: 'Google authentication expired',
                    needsReauth: true
                });
            }
            
            throw new Error(uploadResult.error);
        }
        
        console.log('✅ Upload to Google Sheets successful');
        
        // Increment usage counter
        const { error: incrementError } = await supabase
            .rpc('increment_usage', { p_user_id: apiKeyData.user_id });
            
        if (incrementError) {
            console.error('Failed to increment usage:', incrementError);
            // Don't fail the upload for usage tracking issues
        }
        
        // Log the upload
        const { error: logError } = await supabase
            .from('csv_uploads')
            .insert({
                user_id: apiKeyData.user_id,
                filename: filename || 'unknown.csv',
                file_size: csvContent.length,
                sheet_name: sheetName || 'Sheet1',
                sheet_url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
                upload_type: uploadOptions?.mode || 'append',
                rows_uploaded: rows.length,
                status: 'success',
                processing_time_ms: Date.now() - Date.now(),
                metadata: {
                    delimiter: csvResult.delimiter,
                    processingOptions,
                    uploadOptions
                },
                created_at: new Date().toISOString()
            });
            
        if (logError) {
            console.error('Failed to log upload:', logError);
            // Don't fail the upload for logging issues
        }
        
        // Get updated usage for response
        const { data: updatedUsage } = await supabase
            .from('user_usage')
            .select('*')
            .eq('user_id', apiKeyData.user_id)
            .single();
        
        const finalDaysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
        
        res.json({
            success: true,
            message: `Successfully uploaded ${rows.length} rows to Google Sheets`,
            upload: {
                rowsUploaded: rows.length,
                filename: filename || 'unknown.csv',
                spreadsheetId: spreadsheetId,
                sheetName: sheetName || 'Sheet1',
                spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
                uploadedAt: new Date().toISOString()
            },
            trialStatus: {
                isActive: isTrialActive,
                daysRemaining: finalDaysRemaining,
                uploadsToday: updatedUsage?.uploads_today || 0,
                totalUploads: updatedUsage?.total_uploads || 0
            }
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Upload failed: ' + error.message
        });
    }
}

// Upload to Google Sheets function
async function uploadToGoogleSheets(spreadsheetId, sheetName, rows, uploadOptions, googleToken) {
    try {
        console.log(`📤 Uploading ${rows.length} rows to ${sheetName}`);
        
        const mode = uploadOptions?.mode || 'append';
        
        // Handle different upload modes
        switch (mode) {
            case 'replace-sheet':
                return await replaceSheetContent(spreadsheetId, sheetName, rows, googleToken);
            case 'append-sheet':
                return await appendToSheet(spreadsheetId, sheetName, rows, googleToken);
            case 'replace-spreadsheet':
                return await replaceSpreadsheetContent(spreadsheetId, rows, googleToken);
            case 'new-spreadsheet':
                return await createNewSpreadsheetAndUpload(rows, uploadOptions, googleToken);
            default:
                return await appendToSheet(spreadsheetId, sheetName, rows, googleToken);
        }
        
    } catch (error) {
        console.error('Google Sheets upload error:', error);
        return {
            success: false,
            error: error.message,
            authExpired: error.message.includes('401') || error.message.includes('403')
        };
    }
}

// Replace sheet content
async function replaceSheetContent(spreadsheetId, sheetName, rows, googleToken) {
    console.log('🔄 Replacing sheet content for:', sheetName);
    
    // First clear the sheet
    const clearResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}:clear`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${googleToken}`,
                'Content-Type': 'application/json'
            }
        }
    );
    
    if (!clearResponse.ok) {
        console.warn('Clear failed, continuing with upload...');
    }
    
    // Upload new data
    const range = `${sheetName}!A1`;
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${googleToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: rows
            })
        }
    );
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Replace upload error:', response.status, errorText);
        throw new Error(`Upload failed: ${response.status}`);
    }
    
    return { success: true };
}

// Append to sheet
async function appendToSheet(spreadsheetId, sheetName, rows, googleToken) {
    console.log('➕ Appending to sheet:', sheetName);
    
    const range = `${sheetName}!A:A`;
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${googleToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: rows
            })
        }
    );
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Append error:', response.status, errorText);
        throw new Error(`Append failed: ${response.status}`);
    }
    
    return { success: true };
}

// Replace entire spreadsheet content
async function replaceSpreadsheetContent(spreadsheetId, rows, googleToken) {
    console.log('🔄 Replacing entire spreadsheet content');
    
    // Use Sheet1 as default
    return await replaceSheetContent(spreadsheetId, 'Sheet1', rows, googleToken);
}

// Create new spreadsheet and upload (for new-spreadsheet mode)
async function createNewSpreadsheetAndUpload(rows, uploadOptions, googleToken) {
    console.log('✨ Creating new spreadsheet');
    
    const spreadsheetName = uploadOptions?.sheetName || `CSV Import - ${new Date().toLocaleDateString()}`;
    
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            properties: {
                title: spreadsheetName
            }
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Create spreadsheet error:', response.status, errorText);
        throw new Error(`Failed to create spreadsheet: ${response.status}`);
    }
    
    const newSpreadsheet = await response.json();
    
    // Upload data to the new spreadsheet
    await replaceSheetContent(newSpreadsheet.spreadsheetId, 'Sheet1', rows, googleToken);
    
    return { 
        success: true, 
        newSpreadsheetId: newSpreadsheet.spreadsheetId,
        newSpreadsheetUrl: newSpreadsheet.spreadsheetUrl
    };
}
