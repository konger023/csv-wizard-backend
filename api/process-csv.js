// API endpoint for processing CSV files before upload
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// CSV Processing Functions
function parseCSVContent(csvContent, options = {}) {
    console.log('🔧 Processing CSV for preview...');
    
    try {
        const delimiter = options.delimiter || ',';
        const headerHandling = options.headerHandling || 'use';
        const trimWhitespace = options.trimWhitespace !== false;
        const skipEmptyRows = options.skipEmptyRows !== false;
        const maxPreviewRows = 10; // Only process first 10 rows for preview

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

        // Parse only first few rows for preview
        const previewLines = lines.slice(0, maxPreviewRows + 1); // +1 for header
        const allRowCount = lines.length;

        const rows = [];
        for (let i = 0; i < previewLines.length; i++) {
            const parsedRow = parseCSVLine(previewLines[i], finalDelimiter);
            if (parsedRow.length > 0) {
                rows.push(parsedRow);
            }
        }

        let headers = null;
        let previewData = rows;
        
        if (headerHandling === 'use' && rows.length > 0) {
            headers = rows[0];
            previewData = rows.slice(1);
        }

        // Calculate total rows (excluding header if present)
        const totalDataRows = headerHandling === 'use' ? allRowCount - 1 : allRowCount;

        return {
            success: true,
            headers: headers,
            previewRows: previewData,
            totalRows: totalDataRows,
            delimiter: finalDelimiter,
            metadata: {
                originalRowCount: allRowCount,
                columnCount: headers ? headers.length : (previewData[0] ? previewData[0].length : 0),
                hasHeaders: headerHandling === 'use',
                previewRowCount: previewData.length
            }
        };

    } catch (error) {
        console.error('❌ CSV parsing failed:', error);
        return {
            success: false,
            error: error.message,
            headers: null,
            previewRows: [],
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
        
        // Process CSV for preview
        const result = parseCSVContent(csvContent, processingOptions);
        
        if (!result.success) {
            return res.status(400).json(result);
        }
        
        // Log the processing activity
        const { error: logError } = await supabase
            .from('csv_uploads')
            .insert({
                user_id: apiKeyData.user_id,
                filename: filename || 'unknown.csv',
                file_size: csvContent.length,
                status: 'processed',
                rows_uploaded: 0, // Not uploaded yet, just processed
                metadata: {
                    ...result.metadata,
                    action: 'preview'
                },
                created_at: new Date().toISOString()
            });
            
        if (logError) {
            console.error('Failed to log processing:', logError);
            // Don't fail the request for logging issues
        }
        
        res.json({
            success: true,
            message: 'CSV processed successfully',
            filename: filename || 'unknown.csv',
            headers: result.headers,
            previewRows: result.previewRows,
            totalRows: result.totalRows,
            delimiter: result.delimiter,
            metadata: result.metadata,
            processing: {
                timestamp: new Date().toISOString(),
                readyForUpload: true
            }
        });
        
    } catch (error) {
        console.error('CSV processing error:', error);
        res.status(500).json({
            success: false,
            error: 'Processing failed: ' + error.message
        });
    }
}
