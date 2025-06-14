import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// CSV Processing Functions
function parseCSVContent(csvContent, options = {}) {
    console.log('🔧 Server-side CSV parsing started...');
    
    try {
        const delimiter = options.delimiter || ',';
        const headerHandling = options.headerHandling || 'use';
        const trimWhitespace = options.trimWhitespace !== false;
        const skipEmptyRows = options.skipEmptyRows !== false;
        const maxRows = options.maxRows || 50000;

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

        if (lines.length > maxRows) {
            lines = lines.slice(0, maxRows);
        }

        const rows = [];
        for (let i = 0; i < lines.length; i++) {
            const parsedRow = parseCSVLine(lines[i], finalDelimiter);
            if (parsedRow.length > 0) {
                rows.push(parsedRow);
            }
        }

        let finalRows = rows;
        let headers = null;
        
        if (headerHandling === 'use' && rows.length > 0) {
            headers = rows[0];
            finalRows = rows.slice(1);
        } else if (headerHandling === 'skip' && rows.length > 0) {
            finalRows = rows.slice(1);
        }

        return {
            success: true,
            rows: finalRows,
            headers: headers,
            totalRows: finalRows.length,
            delimiter: finalDelimiter,
            metadata: {
                originalRowCount: lines.length,
                processedRowCount: finalRows.length,
                columnCount: finalRows.length > 0 ? finalRows[0].length : 0,
                hasHeaders: headerHandling === 'use'
            }
        };

    } catch (error) {
        console.error('❌ CSV parsing failed:', error);
        return {
            success: false,
            error: error.message,
            rows: [],
            headers: null,
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

// Google Sheets Functions
async function uploadToGoogleSheets(spreadsheetId, sheetName, csvRows, uploadOptions, googleToken) {
    console.log('📊 Server-side Google Sheets upload...');
    
    try {
        const mode = uploadOptions?.mode || 'append';

        if (!spreadsheetId || !csvRows || csvRows.length === 0) {
            throw new Error('Invalid upload parameters');
        }

        let result;
        if (mode === 'replace') {
            result = await replaceSheetData(spreadsheetId, sheetName, csvRows, googleToken);
        } else {
            result = await appendSheetData(spreadsheetId, sheetName, csvRows, googleToken);
        }

        return {
            success: true,
            spreadsheetId: spreadsheetId,
            sheetName: sheetName,
            rowsUploaded: csvRows.length,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        };

    } catch (error) {
        console.error('❌ Google Sheets upload failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function appendSheetData(spreadsheetId, sheetName, csvRows, googleToken) {
    const range = `${sheetName}!A:A`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: csvRows })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Append failed: ${response.status} - ${errorText}`);
    }

    return { success: true, method: 'append' };
}

async function replaceSheetData(spreadsheetId, sheetName, csvRows, googleToken) {
    // Clear existing data
    const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}:clear`;
    
    await fetch(clearUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
        }
    });

    // Add new data
    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1?valueInputOption=RAW`;
    
    const response = await fetch(putUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: csvRows })
    });

    if (!response.ok) {
        throw new Error(`Replace failed: ${response.status}`);
    }

    return { success: true, method: 'replace' };
}

// Trial Status Checking
async function checkTrialStatus(userId) {
    try {
        const { data: usageData, error } = await supabase
            .from('user_usage')
            .select('plan, trial_ends_at, uploads_today')
            .eq('user_id', userId)
            .single();
        
        if (error) {
            throw error;
        }
        
        const now = new Date();
        const trialEnd = new Date(usageData.trial_ends_at);
        const isTrialExpired = now > trialEnd;
        const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));
        
        const isPaidPlan = usageData.plan === 'pro' || usageData.plan === 'basic';
        
        return {
            isTrialActive: !isTrialExpired && usageData.plan === 'trial',
            isTrialExpired: isTrialExpired && usageData.plan === 'trial',
            trialDaysRemaining: daysRemaining,
            trialEndsAt: usageData.trial_ends_at,
            plan: usageData.plan,
            unlimited: isPaidPlan || (!isTrialExpired && usageData.plan === 'trial'),
            needsUpgrade: isTrialExpired && usageData.plan === 'trial'
        };
        
    } catch (error) {
        console.error('Trial status check failed:', error);
        return {
            isTrialActive: false,
            isTrialExpired: true,
            trialDaysRemaining: 0,
            plan: 'free',
            unlimited: false,
            needsUpgrade: true
        };
    }
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
        
        // Get user from API key
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .select('user_id')
            .eq('api_key', apiKey)
            .eq('is_active', true)
            .single();
        
        if (apiKeyError || !apiKeyData) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API key'
            });
        }
        
        const userId = apiKeyData.user_id;
        
        // Check trial status
        const trialStatus = await checkTrialStatus(userId);
        if (trialStatus.needsUpgrade) {
            return res.status(403).json({
                success: false,
                error: 'Your 7-day free trial has expired. Upgrade to continue uploading CSV files.',
                trialStatus: trialStatus,
                needsUpgrade: true
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
                error: 'Missing required fields: csvContent, spreadsheetId, googleToken'
            });
        }
        
        console.log('🚀 Processing upload with trial system:', {
            filename,
            spreadsheetId: spreadsheetId.substring(0, 10) + '...',
            csvLength: csvContent.length,
            sheetName,
            trialDaysRemaining: trialStatus.trialDaysRemaining
        });
        
        const startTime = Date.now();
        
        // Step 1: Process CSV
        const processResult = parseCSVContent(csvContent, processingOptions);
        if (!processResult.success) {
            return res.status(400).json(processResult);
        }
        
        // Step 2: Upload to Google Sheets
        const uploadResult = await uploadToGoogleSheets(
            spreadsheetId,
            sheetName || 'Sheet1',
            processResult.rows,
            uploadOptions,
            googleToken
        );
        
        if (!uploadResult.success) {
            throw new Error(uploadResult.error || 'Upload failed');
        }
        
        const processingTime = Date.now() - startTime;
        
        // Step 3: Record usage (increment counter)
        await supabase.rpc('increment_usage', { p_user_id: userId });
        
        // Step 4: Log the upload
        await supabase.from('csv_uploads').insert({
            user_id: userId,
            filename: filename,
            file_size: csvContent.length,
            sheet_name: sheetName || 'Sheet1',
            sheet_url: uploadResult.spreadsheetUrl,
            upload_type: uploadOptions?.mode || 'append',
            rows_uploaded: processResult.rows.length,
            status: 'success',
            processing_time_ms: processingTime,
            metadata: {
                columns: processResult.metadata.columnCount,
                hasHeaders: processResult.metadata.hasHeaders,
                delimiter: processResult.delimiter
            }
        });
        
        res.json({
            success: true,
            message: 'Upload completed successfully',
            upload: {
                filename,
                spreadsheetId,
                sheetName: sheetName || 'Sheet1',
                rowsUploaded: processResult.totalRows,
                columnsDetected: processResult.metadata.columnCount,
                timestamp: new Date().toISOString(),
                processingTime: `${processingTime}ms`,
                spreadsheetUrl: uploadResult.spreadsheetUrl
            },
            processing: processResult.metadata,
            trialStatus: trialStatus
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Upload failed: ' + error.message
        });
    }
}
