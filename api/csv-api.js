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
            case 'create-sheet':
                return await handleCreateSheetRedirect(req, res, apiKeyData);
            case 'bulk-queue-create':
                return await handleBulkQueueCreate(req, res, apiKeyData);
            case 'bulk-queue-add-file':
                return await handleBulkQueueAddFile(req, res, apiKeyData);
            case 'bulk-queue-remove-file':
                return await handleBulkQueueRemoveFile(req, res, apiKeyData);
            case 'bulk-queue-list':
                return await handleBulkQueueList(req, res, apiKeyData);
            case 'bulk-queue-update-targets':
                return await handleBulkQueueUpdateTargets(req, res, apiKeyData);
            case 'bulk-queue-execute':
                return await handleBulkQueueExecute(req, res, apiKeyData);
            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown action: ${action}. Available actions: process-csv, complete-upload, create-sheet, bulk-queue-create, bulk-queue-add-file, bulk-queue-remove-file, bulk-queue-list, bulk-queue-update-targets, bulk-queue-execute`
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
    
    // Plan-based feature validation for enterprise features
    const { data: userPlan, error: planError } = await supabase
        .from('user_usage')
        .select('plan')
        .eq('user_id', apiKeyData.user_id)
        .single();

    if (planError) {
        return res.status(500).json({
            success: false,
            error: 'Failed to verify user plan'
        });
    }

    const isEnterprisePlan = userPlan.plan === 'enterprise';

    // Check for enterprise-only features in the request
    const enterpriseFeatures = [];

    // Check for pattern matching feature
    if (req.body.filePattern && req.body.filePattern.trim() !== '') {
        if (!isEnterprisePlan) {
            enterpriseFeatures.push('Smart Pattern Matching');
        }
    }

    // Check for scheduling features
    if (req.body.scheduleOptions && (
        req.body.scheduleOptions.frequency !== 'none' || 
        req.body.scheduleOptions.enabled === true
    )) {
        if (!isEnterprisePlan) {
            enterpriseFeatures.push('Scheduled Upload');
        }
    }

    // Check for advanced processing options
    if (req.body.processingOptions && req.body.processingOptions.advancedOptions === true) {
        if (!isEnterprisePlan) {
            enterpriseFeatures.push('Advanced Processing Options');
        }
    }

    // Block request if non-enterprise user is trying to use enterprise features
    if (enterpriseFeatures.length > 0) {
        console.log(`❌ Enterprise features blocked for user: ${apiKeyData.user_email}, Plan: ${userPlan.plan}`);
        return res.status(403).json({
            success: false,
            error: 'Enterprise features required',
            blockedFeatures: enterpriseFeatures,
            userPlan: userPlan.plan,
            upgradeRequired: true,
            message: `The following features require an Enterprise plan: ${enterpriseFeatures.join(', ')}`
        });
    }

    console.log(`✅ Plan validation passed for user: ${apiKeyData.user_email}, Plan: ${userPlan.plan}`);
    
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

// Redirect create-sheet calls to the proper sheets-api endpoint
async function handleCreateSheetRedirect(req, res, apiKeyData) {
    try {
        const { sheetName, googleToken } = req.body;
        
        console.log('🔄 Redirecting create-sheet call to sheets-api');
        
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
                        title: sheetName?.trim() || `CSV Import - ${new Date().toLocaleDateString()}`
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
            console.error('❌ Google Sheets API error:', response.status);
            
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
        
        console.log('✅ Successfully created spreadsheet via redirect:', newSpreadsheet.spreadsheetId);
        
        return res.json({
            success: true,
            spreadsheet: {
                id: newSpreadsheet.spreadsheetId,
                title: newSpreadsheet.properties.title,
                editUrl: `https://docs.google.com/spreadsheets/d/${newSpreadsheet.spreadsheetId}/edit`,
                createdAt: new Date().toISOString()
            },
            message: `Successfully created "${newSpreadsheet.properties.title}"`,
            note: 'Created via csv-api redirect to Google Sheets API'
        });
        
    } catch (error) {
        console.error('❌ Create sheet redirect error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create sheet: ' + error.message
        });
    }
}

// ===== BULK QUEUE MANAGEMENT FUNCTIONS =====

// Create a new bulk upload job
async function handleBulkQueueCreate(req, res, apiKeyData) {
    try {
        const { jobName, description } = req.body;
        
        const jobId = `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create bulk job record in database
        const { data: job, error } = await supabase
            .from('bulk_upload_jobs')
            .insert({
                job_id: jobId,
                user_id: apiKeyData.user_id,
                user_email: apiKeyData.user_email,
                job_name: jobName || `Bulk Upload ${new Date().toLocaleDateString()}`,
                description: description || '',
                status: 'created',
                files_count: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) {
            console.error('❌ Failed to create bulk job:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to create bulk upload job'
            });
        }
        
        console.log('✅ Created bulk upload job:', jobId);
        
        return res.json({
            success: true,
            job: {
                jobId,
                jobName: job.job_name,
                status: job.status,
                filesCount: 0,
                createdAt: job.created_at
            }
        });
        
    } catch (error) {
        console.error('❌ Bulk queue create error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create bulk job: ' + error.message
        });
    }
}

// Add file to existing bulk job
async function handleBulkQueueAddFile(req, res, apiKeyData) {
    try {
        const { jobId, filename, fileContent, fileSize, uploadOptions } = req.body;
        
        if (!jobId || !filename || !fileContent) {
            return res.status(400).json({
                success: false,
                error: 'jobId, filename, and fileContent are required'
            });
        }
        
        // Verify job belongs to user
        const { data: job, error: jobError } = await supabase
            .from('bulk_upload_jobs')
            .select('*')
            .eq('job_id', jobId)
            .eq('user_id', apiKeyData.user_id)
            .single();
            
        if (jobError || !job) {
            return res.status(404).json({
                success: false,
                error: 'Bulk job not found or access denied'
            });
        }
        
        if (job.status !== 'created' && job.status !== 'building') {
            return res.status(400).json({
                success: false,
                error: 'Cannot add files to job in current status: ' + job.status
            });
        }
        
        const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Add file to bulk_upload_files table
        const { error: fileError } = await supabase
            .from('bulk_upload_files')
            .insert({
                file_id: fileId,
                job_id: jobId,
                user_id: apiKeyData.user_id,
                filename,
                file_content: fileContent,
                file_size: fileSize || fileContent.length,
                upload_options: uploadOptions || {},
                status: 'pending',
                target_spreadsheet_id: uploadOptions?.targetSheet?.spreadsheetId || null,
                target_sheet_name: uploadOptions?.targetSheet?.sheetName || null,
                created_at: new Date().toISOString()
            });
            
        if (fileError) {
            console.error('❌ Failed to add file to bulk job:', fileError);
            return res.status(500).json({
                success: false,
                error: 'Failed to add file to bulk job'
            });
        }
        
        // Update job files count and status
        const { error: updateError } = await supabase
            .from('bulk_upload_jobs')
            .update({
                status: 'building',
                files_count: job.files_count + 1,
                updated_at: new Date().toISOString()
            })
            .eq('job_id', jobId);
            
        if (updateError) {
            console.error('❌ Failed to update job files count:', updateError);
        }
        
        console.log('✅ Added file to bulk job:', filename, '→', jobId);
        
        return res.json({
            success: true,
            file: {
                fileId,
                filename,
                status: 'pending',
                size: fileSize || fileContent.length,
                targetSheet: uploadOptions?.targetSheet || null
            },
            job: {
                jobId,
                filesCount: job.files_count + 1,
                status: 'building'
            }
        });
        
    } catch (error) {
        console.error('❌ Bulk queue add file error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to add file: ' + error.message
        });
    }
}

// Remove specific file from bulk job
async function handleBulkQueueRemoveFile(req, res, apiKeyData) {
    try {
        const { jobId, fileId } = req.body;
        
        if (!jobId || !fileId) {
            return res.status(400).json({
                success: false,
                error: 'jobId and fileId are required'
            });
        }
        
        // Verify file belongs to user's job
        const { data: file, error: fileError } = await supabase
            .from('bulk_upload_files')
            .select('*')
            .eq('file_id', fileId)
            .eq('job_id', jobId)
            .eq('user_id', apiKeyData.user_id)
            .single();
            
        if (fileError || !file) {
            return res.status(404).json({
                success: false,
                error: 'File not found or access denied'
            });
        }
        
        // Delete file record
        const { error: deleteError } = await supabase
            .from('bulk_upload_files')
            .delete()
            .eq('file_id', fileId);
            
        if (deleteError) {
            console.error('❌ Failed to remove file from bulk job:', deleteError);
            return res.status(500).json({
                success: false,
                error: 'Failed to remove file from job'
            });
        }
        
        // Update job files count
        const { data: job, error: jobUpdateError } = await supabase
            .from('bulk_upload_jobs')
            .select('files_count')
            .eq('job_id', jobId)
            .single();
            
        if (!jobUpdateError && job) {
            await supabase
                .from('bulk_upload_jobs')
                .update({
                    files_count: Math.max(0, job.files_count - 1),
                    updated_at: new Date().toISOString()
                })
                .eq('job_id', jobId);
        }
        
        console.log('✅ Removed file from bulk job:', file.filename, '←', jobId);
        
        return res.json({
            success: true,
            removedFile: {
                fileId,
                filename: file.filename
            },
            job: {
                jobId,
                filesCount: Math.max(0, (job?.files_count || 1) - 1)
            }
        });
        
    } catch (error) {
        console.error('❌ Bulk queue remove file error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to remove file: ' + error.message
        });
    }
}

// Get bulk job status and file list
async function handleBulkQueueList(req, res, apiKeyData) {
    try {
        const { jobId } = req.body;
        
        if (!jobId) {
            return res.status(400).json({
                success: false,
                error: 'jobId is required'
            });
        }
        
        // Get job details
        const { data: job, error: jobError } = await supabase
            .from('bulk_upload_jobs')
            .select('*')
            .eq('job_id', jobId)
            .eq('user_id', apiKeyData.user_id)
            .single();
            
        if (jobError || !job) {
            return res.status(404).json({
                success: false,
                error: 'Bulk job not found or access denied'
            });
        }
        
        // Get files in job
        const { data: files, error: filesError } = await supabase
            .from('bulk_upload_files')
            .select('file_id, filename, file_size, status, target_spreadsheet_id, target_sheet_name, created_at, error_message')
            .eq('job_id', jobId)
            .order('created_at', { ascending: true });
            
        if (filesError) {
            console.error('❌ Failed to get bulk job files:', filesError);
            return res.status(500).json({
                success: false,
                error: 'Failed to get job files'
            });
        }
        
        const jobDetails = {
            jobId: job.job_id,
            jobName: job.job_name,
            description: job.description,
            status: job.status,
            filesCount: job.files_count,
            createdAt: job.created_at,
            updatedAt: job.updated_at,
            startedAt: job.started_at,
            completedAt: job.completed_at
        };
        
        const filesList = files.map(file => ({
            fileId: file.file_id,
            filename: file.filename,
            size: file.file_size,
            status: file.status,
            targetSheet: file.target_spreadsheet_id ? {
                spreadsheetId: file.target_spreadsheet_id,
                sheetName: file.target_sheet_name
            } : null,
            createdAt: file.created_at,
            error: file.error_message
        }));
        
        return res.json({
            success: true,
            job: jobDetails,
            files: filesList
        });
        
    } catch (error) {
        console.error('❌ Bulk queue list error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get job details: ' + error.message
        });
    }
}

// Update target sheets for files in bulk job
async function handleBulkQueueUpdateTargets(req, res, apiKeyData) {
    try {
        const { jobId, fileTargets } = req.body;
        
        if (!jobId || !fileTargets || !Array.isArray(fileTargets)) {
            return res.status(400).json({
                success: false,
                error: 'jobId and fileTargets array are required'
            });
        }
        
        // Verify job belongs to user
        const { data: job, error: jobError } = await supabase
            .from('bulk_upload_jobs')
            .select('*')
            .eq('job_id', jobId)
            .eq('user_id', apiKeyData.user_id)
            .single();
            
        if (jobError || !job) {
            return res.status(404).json({
                success: false,
                error: 'Bulk job not found or access denied'
            });
        }
        
        // Update each file's target sheet
        const updatePromises = fileTargets.map(async ({ fileId, targetSheet }) => {
            return supabase
                .from('bulk_upload_files')
                .update({
                    target_spreadsheet_id: targetSheet?.spreadsheetId || null,
                    target_sheet_name: targetSheet?.sheetName || null,
                    updated_at: new Date().toISOString()
                })
                .eq('file_id', fileId)
                .eq('job_id', jobId)
                .eq('user_id', apiKeyData.user_id);
        });
        
        const results = await Promise.all(updatePromises);
        const errors = results.filter(result => result.error);
        
        if (errors.length > 0) {
            console.error('❌ Some target updates failed:', errors);
            return res.status(500).json({
                success: false,
                error: 'Failed to update some file targets'
            });
        }
        
        console.log('✅ Updated target sheets for bulk job:', jobId);
        
        return res.json({
            success: true,
            updatedFiles: fileTargets.length,
            job: {
                jobId,
                status: job.status
            }
        });
        
    } catch (error) {
        console.error('❌ Bulk queue update targets error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update targets: ' + error.message
        });
    }
}

// Execute bulk upload job
async function handleBulkQueueExecute(req, res, apiKeyData) {
    try {
        const { jobId } = req.body;
        
        if (!jobId) {
            return res.status(400).json({
                success: false,
                error: 'jobId is required'
            });
        }
        
        // Get job and files
        const { data: job, error: jobError } = await supabase
            .from('bulk_upload_jobs')
            .select('*')
            .eq('job_id', jobId)
            .eq('user_id', apiKeyData.user_id)
            .single();
            
        if (jobError || !job) {
            return res.status(404).json({
                success: false,
                error: 'Bulk job not found or access denied'
            });
        }
        
        if (job.status !== 'building' && job.status !== 'created') {
            return res.status(400).json({
                success: false,
                error: 'Job cannot be executed in current status: ' + job.status
            });
        }
        
        // Get files to process
        const { data: files, error: filesError } = await supabase
            .from('bulk_upload_files')
            .select('*')
            .eq('job_id', jobId)
            .eq('status', 'pending');
            
        if (filesError) {
            console.error('❌ Failed to get files for execution:', filesError);
            return res.status(500).json({
                success: false,
                error: 'Failed to get files for processing'
            });
        }
        
        if (files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No pending files to process'
            });
        }
        
        // Update job status to processing
        await supabase
            .from('bulk_upload_jobs')
            .update({
                status: 'processing',
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('job_id', jobId);
        
        // Process files one by one (in background we could make this parallel)
        let successCount = 0;
        let errorCount = 0;
        
        for (const file of files) {
            try {
                // Mark file as processing
                await supabase
                    .from('bulk_upload_files')
                    .update({ status: 'processing' })
                    .eq('file_id', file.file_id);
                
                // Create a mock request object for the CSV processing
                const mockReq = {
                    body: {
                        action: 'complete-upload',
                        csvContent: file.file_content,
                        filename: file.filename,
                        spreadsheetId: file.target_spreadsheet_id,
                        sheetName: file.target_sheet_name,
                        ...file.upload_options
                    }
                };
                
                // Create a mock response object to capture the result
                let uploadResult = null;
                let uploadError = null;
                
                const mockRes = {
                    json: (data) => { uploadResult = data; },
                    status: (code) => ({
                        json: (data) => { 
                            uploadError = { status: code, ...data }; 
                        }
                    })
                };
                
                // Process the file using existing upload logic
                await handleCompleteUpload(mockReq, mockRes, apiKeyData);
                
                if (uploadResult && uploadResult.success) {
                    // Mark file as completed
                    await supabase
                        .from('bulk_upload_files')
                        .update({
                            status: 'completed',
                            completed_at: new Date().toISOString(),
                            result_data: uploadResult
                        })
                        .eq('file_id', file.file_id);
                    
                    successCount++;
                    console.log('✅ Bulk file processed:', file.filename);
                } else {
                    // Mark file as failed
                    await supabase
                        .from('bulk_upload_files')
                        .update({
                            status: 'failed',
                            error_message: uploadError?.error || 'Unknown upload error',
                            completed_at: new Date().toISOString()
                        })
                        .eq('file_id', file.file_id);
                    
                    errorCount++;
                    console.error('❌ Bulk file failed:', file.filename, uploadError?.error);
                }
                
            } catch (fileError) {
                // Mark file as failed
                await supabase
                    .from('bulk_upload_files')
                    .update({
                        status: 'failed',
                        error_message: fileError.message,
                        completed_at: new Date().toISOString()
                    })
                    .eq('file_id', file.file_id);
                
                errorCount++;
                console.error('❌ Bulk file processing error:', file.filename, fileError);
            }
        }
        
        // Update job status to completed
        const finalStatus = errorCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'partial');
        
        await supabase
            .from('bulk_upload_jobs')
            .update({
                status: finalStatus,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                success_count: successCount,
                error_count: errorCount
            })
            .eq('job_id', jobId);
        
        console.log('✅ Bulk job completed:', jobId, `${successCount} success, ${errorCount} errors`);
        
        return res.json({
            success: true,
            job: {
                jobId,
                status: finalStatus,
                processedFiles: files.length,
                successCount,
                errorCount
            },
            message: `Bulk upload completed: ${successCount} successful, ${errorCount} failed`
        });
        
    } catch (error) {
        // Mark job as failed
        await supabase
            .from('bulk_upload_jobs')
            .update({
                status: 'failed',
                error_message: error.message,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('job_id', jobId);
        
        console.error('❌ Bulk queue execute error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to execute bulk job: ' + error.message
        });
    }
}
