// pages/api/upload-csv.js
import { google } from 'googleapis';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get API key from Authorization header
        const authHeader = req.headers.authorization;
        const apiKey = authHeader?.replace('Bearer ', '');
        
        if (!apiKey) {
            return res.status(401).json({ error: 'No API key provided' });
        }

        // Verify API key
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('api_key', apiKey)
            .single();

        if (!user) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        // SECURITY FIX: Add trial validation to prevent expired users from uploading
        console.log('🔍 Checking trial status for user:', user.email);
        
        // Check trial status
        const { data: usage, error: usageError } = await supabase
            .from('user_usage')
            .select('*')
            .eq('user_id', user.user_id)
            .single();
            
        if (usageError || !usage) {
            console.log('❌ User usage data not found for:', user.email);
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
        
        console.log('📊 Trial status check:', {
            user: user.email,
            plan: usage.plan,
            trialEnd: usage.trial_ends_at,
            now: now.toISOString(),
            isTrialActive,
            daysRemaining
        });
        
        if (!isTrialActive && usage.plan === 'trial') {
            console.log('❌ BLOCKED: Trial expired for user:', user.email);
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
        
        console.log('✅ Trial validation passed for user:', user.email);

        const {
            csvContent,
            csvFileName,
            spreadsheetId,
            sheetName,
            uploadMode,
            googleToken,
            createNewTab
        } = req.body;
        
        // Validate inputs
        if (!csvContent || !spreadsheetId || !sheetName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        console.log(`📤 Processing upload: ${csvFileName} → ${sheetName}`);
        
        // Initialize Google Sheets API
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: googleToken });
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Parse CSV with your secret parsing logic
        const parsedData = await parseCSVWithMagic(csvContent);
        
        // Create new tab if needed
        if (createNewTab) {
            await createSheetTab(sheets, spreadsheetId, sheetName);
        }
        
        // Perform the upload based on mode
        let result;
        if (uploadMode === 'replace') {
            result = await replaceSheetData(sheets, spreadsheetId, sheetName, parsedData);
        } else {
            result = await appendSheetData(sheets, spreadsheetId, sheetName, parsedData);
        }
        
        // Log usage for the user
        await supabase.from('usage_logs').insert({
            user_id: user.id,
            action: 'csv_upload',
            file_name: csvFileName,
            row_count: parsedData.rows.length,
            spreadsheet_id: spreadsheetId,
            sheet_name: sheetName
        });
        
        res.json({
            success: true,
            rowsUploaded: parsedData.rows.length,
            columnsDetected: parsedData.headers.length,
            sheetName: sheetName,
            mode: uploadMode
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Upload failed'
        });
    }
}

// ==========================================
// SECRET SAUCE - CSV PARSING LOGIC
// ==========================================
async function parseCSVWithMagic(csvContent) {
    try {
        // Parse with advanced options
        const records = parse(csvContent, {
            columns: false,
            skip_empty_lines: true,
            trim: true,
            relax_quotes: true,
            relax_column_count: true,
            skip_records_with_error: true
        });
        
        if (records.length === 0) {
            throw new Error('No data found in CSV');
        }
        
        // Smart header detection
        let headers = records[0];
        let dataRows = records.slice(1);
        
        // Your secret sauce for header detection
        if (!looksLikeHeader(headers)) {
            // First row is data, generate headers
            headers = headers.map((_, i) => `Column ${i + 1}`);
            dataRows = records; // Include first row as data
        }
        
        // Clean and normalize headers
        headers = headers.map(h => cleanHeaderName(h));
        
        // Process data rows with your magic
        const processedRows = dataRows.map(row => {
            return row.map(cell => {
                // Your secret cell processing logic
                return processCellValue(cell);
            });
        });
        
        // Detect data types for each column
        const columnTypes = detectColumnTypes(processedRows);
        
        // Format data for Google Sheets
        const sheetData = [headers, ...processedRows];
        
        return {
            headers,
            rows: processedRows,
            columnTypes,
            sheetData
        };
        
    } catch (error) {
        console.error('CSV parsing error:', error);
        throw new Error('Failed to parse CSV: ' + error.message);
    }
}

// Check if row looks like headers
function looksLikeHeader(row) {
    const nonNumericCount = row.filter(cell => 
        isNaN(cell) && !isDate(cell)
    ).length;
    
    return nonNumericCount > row.length * 0.7;
}

// Clean header names
function cleanHeaderName(header) {
    return String(header)
        .trim()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 50);
}

// Process cell values
function processCellValue(cell) {
    if (cell === null || cell === undefined || cell === '') {
        return '';
    }
    
    // Trim whitespace
    cell = String(cell).trim();
    
    // Handle special values
    if (cell.toLowerCase() === 'null' || cell.toLowerCase() === 'n/a') {
        return '';
    }
    
    // Your magic number/date formatting
    if (isDate(cell)) {
        return formatDate(cell);
    }
    
    if (isNumber(cell)) {
        return formatNumber(cell);
    }
    
    return cell;
}

// Detect column types
function detectColumnTypes(rows) {
    const columnCount = rows[0]?.length || 0;
    const types = [];
    
    for (let col = 0; col < columnCount; col++) {
        const values = rows.map(row => row[col]).filter(v => v !== '');
        
        if (values.every(v => isNumber(v))) {
            types.push('number');
        } else if (values.every(v => isDate(v))) {
            types.push('date');
        } else {
            types.push('string');
        }
    }
    
    return types;
}

// ==========================================
// GOOGLE SHEETS OPERATIONS
// ==========================================
async function createSheetTab(sheets, spreadsheetId, sheetName) {
    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    addSheet: {
                        properties: {
                            title: sheetName
                        }
                    }
                }]
            }
        });
        console.log(`✅ Created new tab: ${sheetName}`);
    } catch (error) {
        console.error('Failed to create tab:', error);
        throw new Error('Failed to create new tab');
    }
}

async function appendSheetData(sheets, spreadsheetId, sheetName, parsedData) {
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: parsedData.sheetData
            }
        });
        
        return {
            updatedCells: response.data.updates.updatedCells,
            updatedRange: response.data.updates.updatedRange
        };
    } catch (error) {
        console.error('Append error:', error);
        throw new Error('Failed to append data');
    }
}

async function replaceSheetData(sheets, spreadsheetId, sheetName, parsedData) {
    try {
        // Clear existing data first
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetName}!A:Z`
        });
        
        // Add new data
        const response = await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: parsedData.sheetData
            }
        });
        
        // Apply smart formatting
        await applySmartFormatting(sheets, spreadsheetId, sheetName, parsedData);
        
        return {
            updatedCells: response.data.updatedCells,
            updatedRange: response.data.updatedRange
        };
    } catch (error) {
        console.error('Replace error:', error);
        throw new Error('Failed to replace data');
    }
}

async function applySmartFormatting(sheets, spreadsheetId, sheetName, parsedData) {
    const requests = [];
    
    // Get sheet ID first
    const sheetId = await getSheetId(sheets, spreadsheetId, sheetName);
    
    // Format headers
    requests.push({
        repeatCell: {
            range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    textFormat: { bold: true }
                }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
        }
    });
    
    // Apply column-specific formatting
    parsedData.columnTypes.forEach((type, index) => {
        if (type === 'number') {
            requests.push({
                repeatCell: {
                    range: {
                        sheetId: sheetId,
                        startColumnIndex: index,
                        endColumnIndex: index + 1,
                        startRowIndex: 1
                    },
                    cell: {
                        userEnteredFormat: {
                            numberFormat: {
                                type: 'NUMBER',
                                pattern: '#,##0.00'
                            }
                        }
                    },
                    fields: 'userEnteredFormat.numberFormat'
                }
            });
        }
    });
    
    if (requests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
    }
}

// Helper functions
async function getSheetId(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = response.data.sheets.find(s => 
        s.properties.title === sheetName
    );
    return sheet?.properties?.sheetId || 0;
}

function isDate(value) {
    // Your date detection logic
    return false; // Simplified for now
}

function isNumber(value) {
    return !isNaN(value) && !isNaN(parseFloat(value));
}

function formatDate(value) {
    // Your date formatting logic
    return value;
}

function formatNumber(value) {
    return parseFloat(value);
}
