// Combined CSV API - Handles all CSV processing and upload operations
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
        const isPreview = options.isPreview || false;
        const maxPreviewRows = isPreview ? 10 : Infinity;

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

        // For preview, only process first few rows
        const processLines = isPreview ? lines.slice(0, maxPreviewRows + 1) : lines;
        const allRowCount = lines.length;

        const rows = [];
        for (let i = 0; i < processLines.length; i++) {
            const parsedRow = parseCSVLine(processLines[i], finalDelimiter);
            if (parsedRow.length > 0) {
                rows.push(parsedRow);
            }
        }

        let headers = null;
        let dataRows = rows;
        
        // Debug header handling processing
        console.log('===== HEADER PROCESSING DEBUG =====');
        console.log('headerHandling value:', headerHandling);
        console.log('rows.length:', rows.length);
        console.log('First row (sample):', rows[0]?.slice(0, 3)); // Show first 3 columns
        
        if (headerHandling === 'use' && rows.length > 0) {
            headers = rows[0];
            dataRows = rows.slice(1);
            console.log('Using first row as headers:', headers?.slice(0, 3));
            console.log('Data rows count after header removal:', dataRows.length);
        } else if (headerHandling === 'skip' && rows.length > 0) {
            // Skip first row and don't create any headers
            dataRows = rows.slice(1);
            headers = null; // No headers for skip mode - just start with data
            console.log('Skipping first row, NO headers created');
            console.log('Data rows count after skipping first row:', dataRows.length);
        } else {
            console.log('No header processing (using all rows as data)');
        }
        console.log('==================================');

        // Calculate total rows based on header handling
        const totalDataRows = (headerHandling === 'use' || headerHandling === 'skip') ? allRowCount - 1 : allRowCount;

        // Create sheetData for Google Sheets upload (headers + data combined)
        let sheetData;
        if (headers && headers.length > 0) {
            // Include headers as first row, then data rows (for "use headers" mode)
            sheetData = [headers, ...dataRows];
            console.log('✅ Created sheetData with headers as first row');
            console.log('🔍 Headers:', headers?.slice(0, 3));
            console.log('🔍 First data row:', dataRows[0]?.slice(0, 3));
            console.log('🔍 Second data row:', dataRows[1]?.slice(0, 3));
        } else {
            // No headers, just data rows (for "skip" mode)
            sheetData = dataRows;
            console.log('✅ Created sheetData without headers - pure data only');
            console.log('🔍 First row (was 2nd row in CSV):', dataRows[0]?.slice(0, 3));
            console.log('🔍 Second row (was 3rd row in CSV):', dataRows[1]?.slice(0, 3));
        }
        
        // CRITICAL DEBUG: Show exactly what will be sent to Google Sheets
        console.log('🚨 FINAL SHEETDATA DEBUG 🚨');
        console.log('Headers value:', headers);
        console.log('Headers type:', typeof headers);
        console.log('Headers length:', headers?.length);
        console.log('SheetData total rows:', sheetData.length);
        console.log('SheetData row 1:', JSON.stringify(sheetData[0]?.slice(0, 5)));
        console.log('SheetData row 2:', JSON.stringify(sheetData[1]?.slice(0, 5))); 
        console.log('SheetData row 3:', JSON.stringify(sheetData[2]?.slice(0, 5)));
        console.log('🚨 END SHEETDATA DEBUG 🚨');

        return {
            success: true,
            headers: headers,
            rows: dataRows, // Processed data rows only (for preview/display)
            sheetData: sheetData, // Headers + data combined (for Google Sheets upload)
            totalRows: dataRows.length,
            delimiter: finalDelimiter,
            metadata: {
                originalRowCount: allRowCount,
                columnCount: headers ? headers.length : (dataRows[0] ? dataRows[0].length : 0),
                hasHeaders: headerHandling === 'use',
                previewRowCount: isPreview ? dataRows.length : undefined
            }
        };

    } catch (error) {
        console.error('❌ CSV parsing failed:', error);
        return {
            success: false,
            error: error.message,
            headers: null,
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
        const action = req.body?.action;
        
        if (!action) {
            return res.status(400).json({
                success: false,
                error: 'Action parameter required'
            });
        }
        
        console.log(`📄 CSV API - Action: ${action} for user: ${apiKeyData.user_email}`);
        
        switch (action) {
            case 'process-csv':
                return await handleProcessCSV(req, res, apiKeyData);
            case 'complete-upload':
                return await handleCompleteUpload(req, res, apiKeyData);
            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown action: ${action}. Available actions: process-csv, complete-upload`
                });
        }
        
    } catch (error) {
        console.error('CSV API error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
}

// Handle CSV processing for preview
async function handleProcessCSV(req, res, apiKeyData) {
    const { csvContent, filename, processingOptions } = req.body;
    
    if (!csvContent) {
        return res.status(400).json({
            success: false,
            error: 'CSV content is required'
        });
    }
    
    console.log('🔄 Processing CSV for preview:', {
        filename,
        size: csvContent.length,
        user: apiKeyData.user_email
    });
    
    // Debug processing options
    console.log('===== CSV PROCESSING DEBUG (PREVIEW) =====');
    console.log('Processing options received:', processingOptions);
    console.log('Header handling:', processingOptions?.headerHandling);
    console.log('========================================');
    
    // SECURITY: Sanitize CSV content to remove any file URLs or unwanted data
    let sanitizedContent = csvContent;
    if (typeof csvContent === 'string') {
        // Remove any file:// URLs that might have been accidentally appended
        sanitizedContent = csvContent.replace(/file:\/\/\/[^\s\n\r,]*/g, '');
        // Remove any other suspicious URL patterns
        sanitizedContent = sanitizedContent.replace(/^https?:\/\/[^\s\n\r,]*$/gm, '');
        // Clean up any empty lines that may have been left
        sanitizedContent = sanitizedContent.replace(/\n\s*\n/g, '\n').trim();
    }
    
    // Process CSV for preview (limited rows) using sanitized content
    const result = parseCSVContent(sanitizedContent, {
        ...processingOptions,
        isPreview: true
    });
    
    if (!result.success) {
        return res.status(400).json(result);
    }
    
    // Log the processing activity
    await supabase
        .from('csv_uploads')
        .insert({
            user_id: apiKeyData.user_id,
            filename: filename || 'unknown.csv',
            file_size: csvContent.length,
            status: 'processed',
            rows_uploaded: 0,
            metadata: {
                ...result.metadata,
                action: 'preview'
            },
            created_at: new Date().toISOString()
        });
    
    return res.json({
        success: true,
        message: 'CSV processed successfully',
        filename: filename || 'unknown.csv',
        headers: result.headers,
        previewRows: result.rows,
        totalRows: result.totalRows,
        delimiter: result.delimiter,
        metadata: result.metadata,
        processing: {
            timestamp: new Date().toISOString(),
            readyForUpload: true
        }
    });
}

// Handle complete upload
async function handleCompleteUpload(req, res, apiKeyData) {
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
    
    // SECURITY: Sanitize CSV content to remove any file URLs or unwanted data
    let sanitizedContent = csvContent;
    if (typeof csvContent === 'string') {
        // Remove any file:// URLs that might have been accidentally appended
        sanitizedContent = csvContent.replace(/file:\/\/\/[^\s\n\r,]*/g, '');
        // Remove any other suspicious URL patterns
        sanitizedContent = sanitizedContent.replace(/^https?:\/\/[^\s\n\r,]*$/gm, '');
        // Clean up any empty lines that may have been left
        sanitizedContent = sanitizedContent.replace(/\n\s*\n/g, '\n').trim();
    }
    
    console.log('🔄 Processing complete upload:', {
        filename,
        spreadsheetId,
        sheetName,
        user: apiKeyData.user_email,
        csvSize: csvContent.length
    });
    
    // Debug processing options for upload
    console.log('===== CSV PROCESSING DEBUG (UPLOAD) =====');
    console.log('Processing options received:', processingOptions);
    console.log('Header handling:', processingOptions?.headerHandling);
    console.log('======================================');
    
    // Parse CSV content for upload (using sanitized content)
    const csvResult = parseCSVContent(sanitizedContent, {
        ...processingOptions,
        isPreview: false
    });
    
    if (!csvResult.success) {
        return res.status(400).json({
            success: false,
            error: 'CSV parsing failed: ' + csvResult.error
        });
    }
    
    const { sheetData } = csvResult;
    
    if (!sheetData || sheetData.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'No data found in CSV file'
        });
    }
    
    console.log(`📊 Parsed ${sheetData.length} rows from CSV (including headers)`);
    
    // CRITICAL DEBUG: Log what's being sent to Google Sheets (limited to prevent crash)
    console.log('🚨 ABOUT TO UPLOAD TO GOOGLE SHEETS 🚨');
    console.log('Data being sent - Total rows:', sheetData.length);
    console.log('Row 1 FIRST 5 VALUES:', JSON.stringify(sheetData[0]?.slice(0, 5)));
    console.log('Row 2 FIRST 5 VALUES:', JSON.stringify(sheetData[1]?.slice(0, 5)));
    console.log('Row 3 FIRST 5 VALUES:', JSON.stringify(sheetData[2]?.slice(0, 5)));
    console.log('🚨 END UPLOAD DEBUG 🚨');
    
    // Upload to Google Sheets
    const uploadResult = await uploadToGoogleSheets(
        spreadsheetId,
        sheetName || 'Sheet1',
        sheetData,
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
        
        return res.status(400).json({
            success: false,
            error: 'Upload failed: ' + uploadResult.error
        });
    }
    
    console.log(`✅ Upload successful: ${uploadResult.rowsUploaded} rows`);
    
    // Update usage counters
    await supabase.rpc('increment_usage', { 
        p_user_id: apiKeyData.user_id 
    });
    
    // Log the successful upload
    const { error: logError } = await supabase
        .from('csv_uploads')
        .insert({
            user_id: apiKeyData.user_id,
            filename: filename || 'unknown.csv',
            file_size: csvContent.length,
            sheet_name: sheetName || 'Sheet1',
            sheet_url: uploadResult.spreadsheetUrl,
            upload_type: uploadOptions?.mode || 'append',
            status: 'success',
            rows_uploaded: uploadResult.rowsUploaded,
            spreadsheet_id: spreadsheetId,
            metadata: {
                ...csvResult.metadata,
                action: 'complete_upload',
                processingOptions,
                uploadOptions
            },
            created_at: new Date().toISOString()
        });
    
    if (logError) {
        console.error('Failed to log upload:', logError);
    }
    
    // Return updated trial status
    const updatedDaysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
    
    return res.json({
        success: true,
        message: 'CSV uploaded successfully',
        upload: {
            filename: filename || 'unknown.csv',
            rowsUploaded: uploadResult.rowsUploaded,
            columnsUploaded: csvResult.headers?.length || 0,
            spreadsheetId: spreadsheetId,
            spreadsheetUrl: uploadResult.spreadsheetUrl,
            sheetName: sheetName || 'Sheet1'
        },
        trialStatus: {
            isActive: isTrialActive,
            daysRemaining: updatedDaysRemaining,
            uploadsRemaining: usage.uploads_today || 0
        }
    });
}

// Google Sheets Upload Function
async function uploadToGoogleSheets(spreadsheetId, sheetName, rows, uploadOptions, googleToken) {
    try {
        console.log(`📊 Uploading ${rows.length} rows to Google Sheets...`);
        
        if (!rows || rows.length === 0) {
            return {
                success: false,
                error: 'No data to upload'
            };
        }
        
        // Test Google Token first
        const testResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${googleToken}` }
        });
        
        if (!testResponse.ok) {
            console.error('Google token invalid:', testResponse.status);
            return {
                success: false,
                error: 'Google authentication expired',
                authExpired: true
            };
        }
        
        // Get spreadsheet info
        const spreadsheetResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
            {
                headers: { 'Authorization': `Bearer ${googleToken}` }
            }
        );
        
        if (!spreadsheetResponse.ok) {
            console.error('Failed to access spreadsheet:', spreadsheetResponse.status);
            return {
                success: false,
                error: 'Cannot access spreadsheet. Check permissions.'
            };
        }
        
        const spreadsheetData = await spreadsheetResponse.json();
        const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        
        // Choose upload method
        let uploadResponse;
        if (uploadOptions?.mode === 'replace') {
            // Replace mode - clear and replace all data
            const range = `${sheetName}!A:Z`;
            
            // First clear the sheet
            await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${googleToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            // Then add new data
            uploadResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1?valueInputOption=USER_ENTERED`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${googleToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        values: rows,
                        majorDimension: 'ROWS'
                    })
                }
            );
        } else {
            // Append mode
            uploadResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${googleToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        values: rows,
                        majorDimension: 'ROWS'
                    })
                }
            );
        }
        
        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error('Upload failed:', uploadResponse.status, errorText);
            return {
                success: false,
                error: `Upload failed: ${uploadResponse.status} - ${errorText}`
            };
        }
        
        const uploadResult = await uploadResponse.json();
        
        // Apply formatting if enabled
        if (uploadOptions?.autoFormat) {
            await applyAutoFormatting(spreadsheetId, sheetName, rows, googleToken);
        }
        
        return {
            success: true,
            rowsUploaded: rows.length,
            spreadsheetUrl: spreadsheetUrl,
            updatedRange: uploadResult.updatedRange || `${sheetName}!A1:Z${rows.length}`,
            updatedCells: uploadResult.updatedCells || rows.length * (rows[0]?.length || 0)
        };
        
    } catch (error) {
        console.error('Upload error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Auto-formatting function
async function applyAutoFormatting(spreadsheetId, sheetName, rows, googleToken) {
    try {
        // Get sheet ID
        const spreadsheetResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
            { headers: { 'Authorization': `Bearer ${googleToken}` } }
        );
        
        if (!spreadsheetResponse.ok) return;
        
        const spreadsheetData = await spreadsheetResponse.json();
        const sheet = spreadsheetData.sheets.find(s => s.properties.title === sheetName);
        
        if (!sheet) return;
        
        const sheetId = sheet.properties.sheetId;
        const requests = [];
        
        // Format headers (first row)
        if (rows.length > 0) {
            requests.push({
                repeatCell: {
                    range: {
                        sheetId: sheetId,
                        startRowIndex: 0,
                        endRowIndex: 1,
                        startColumnIndex: 0,
                        endColumnIndex: rows[0].length
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                            textFormat: { bold: true },
                            horizontalAlignment: 'CENTER'
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            });
        }
        
        // Auto-resize columns
        requests.push({
            autoResizeDimensions: {
                dimensions: {
                    sheetId: sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: rows[0]?.length || 10
                }
            }
        });
        
        if (requests.length > 0) {
            await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${googleToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ requests })
                }
            );
        }
        
        console.log('✅ Auto-formatting applied');
        
    } catch (error) {
        console.log('⚠️ Formatting failed (non-critical):', error.message);
    }
}
