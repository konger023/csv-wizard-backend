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
        
        if (headerHandling === 'use' && rows.length > 0) {
            headers = rows[0];
            dataRows = rows.slice(1);
        }

        // Calculate total rows
        const totalDataRows = headerHandling === 'use' ? allRowCount - 1 : allRowCount;

        return {
            success: true,
            headers: headers,
            rows: isPreview ? dataRows : rows,
            totalRows: isPreview ? totalDataRows : dataRows.length,
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
    
    // Process CSV for preview (limited rows)
    const result = parseCSVContent(csvContent, {
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
    
    console.log('🔄 Processing complete upload:', {
        filename,
        spreadsheetId,
        sheetName,
        user: apiKeyData.user_email,
        csvSize: csvContent.length
    });
    
    // Parse CSV content for upload
    const csvResult = parseCSVContent(csvContent, {
        ...processingOptions,
        isPreview: false
    });
    
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
                nee