// Add this to the end of api/csv-api.js to complete the upload function

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
    const now = new Date();
    const trialEnd = new Date(usage.trial_ends_at);
    const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
    
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
            daysRemaining: daysRemaining,
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
            
            if (spreadsheetResponse.status === 401 || spreadsheetResponse.status === 403) {
                return {
                    success: false,
                    error: 'Google authentication expired',
                    authExpired: true
                };
            }
            
            return {
                success: false,
                error: 'Cannot access Google Spreadsheet. Please check the URL and permissions.'
            };
        }
        
        const spreadsheetData = await spreadsheetResponse.json();
        const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        
        // Check if sheet/tab exists
        const sheets = spreadsheetData.sheets || [];
        const targetSheet = sheets.find(s => s.properties.title === sheetName);
        
        if (!targetSheet) {
            console.log(`Creating new tab: ${sheetName}`);
            
            // Create new sheet tab
            const createResponse = await fetch(
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
                                    title: sheetName,
                                    gridProperties: {
                                        rowCount: Math.max(1000, rows.length + 100),
                                        columnCount: Math.max(26, rows[0]?.length || 10)
                                    }
                                }
                            }
                        }]
                    })
                }
            );
            
            if (!createResponse.ok) {
                return {
                    success: false,
                    error: `Failed to create sheet tab "${sheetName}"`
                };
            }
        }
        
        // Determine upload method
        const mode = uploadOptions?.mode || 'append';
        let uploadResponse;
        
        if (mode === 'replace') {
            // Clear existing data first
            await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A:Z:clear`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${googleToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            // Upload new data
            uploadResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1`,
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
        
        console.log('✅ Upload completed successfully');
        
        return {
            success: true,
            rowsUploaded: rows.length,
            updatedCells: uploadResult.updatedCells || rows.length * (rows[0]?.length || 0),
            updatedRange: uploadResult.updatedRange,
            spreadsheetUrl: spreadsheetUrl,
            sheetName: sheetName
        };
        
    } catch (error) {
        console.error('❌ Upload error:', error);
        return {
            success: false,
            error: error.message || 'Upload failed'
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
