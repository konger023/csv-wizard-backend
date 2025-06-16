// Enhanced CSV Wizard Background Script - Better CSV Detection and Interception
console.log('🔄 CSV Wizard background script starting with enhanced detection...');

let lastCSVDownload = null;
let csvDetectionQueue = [];
let isProcessingQueue = false;

// Enhanced CSV download detection using Chrome Downloads API
chrome.downloads.onCreated.addListener((downloadItem) => {
    console.log('📥 Download detected:', {
        filename: downloadItem.filename,
        url: downloadItem.url,
        mime: downloadItem.mime,
        state: downloadItem.state
    });
    
    const filename = downloadItem.filename || '';
    const url = downloadItem.url || '';
    const mimeType = downloadItem.mime || '';
    
    // Enhanced CSV detection
    const isCSV = isCSVFile(filename, url, mimeType);
    
    if (isCSV) {
        console.log('✅ CSV detected! Processing...', filename);
        
        const csvInfo = {
            filename: filename,
            url: url,
            downloadId: downloadItem.id,
            mimeType: mimeType,
            timestamp: Date.now(),
            state: downloadItem.state || 'in_progress',
            type: 'download_api'
        };
        
        // Add to processing queue
        csvDetectionQueue.push(csvInfo);
        processCSVQueue();
        
        // Try to intercept and get content
        interceptCSVContent(csvInfo);
    }
});

// Enhanced CSV file detection
function isCSVFile(filename, url, mimeType) {
    // Check filename
    if (filename && (
        filename.toLowerCase().endsWith('.csv') ||
        filename.toLowerCase().endsWith('.tsv') ||
        filename.toLowerCase().includes('csv')
    )) {
        return true;
    }
    
    // Check URL patterns
    if (url && (
        url.toLowerCase().includes('.csv') ||
        url.toLowerCase().includes('format=csv') ||
        url.toLowerCase().includes('export') && url.toLowerCase().includes('csv') ||
        url.toLowerCase().includes('download') && url.toLowerCase().includes('csv')
    )) {
        return true;
    }
    
    // Check MIME type
    if (mimeType && (
        mimeType.includes('csv') ||
        mimeType.includes('comma-separated') ||
        mimeType === 'text/csv' ||
        mimeType === 'application/csv'
    )) {
        return true;
    }
    
    // Check for common CSV export patterns
    if (url && (
        url.includes('export') ||
        url.includes('download') ||
        url.includes('report')
    ) && (
        url.includes('csv') ||
        filename.includes('csv')
    )) {
        return true;
    }
    
    return false;
}

// Process CSV detection queue
async function processCSVQueue() {
    if (isProcessingQueue || csvDetectionQueue.length === 0) {
        return;
    }
    
    isProcessingQueue = true;
    
    while (csvDetectionQueue.length > 0) {
        const csvInfo = csvDetectionQueue.shift();
        await handleCSVDetection(csvInfo);
        
        // Small delay to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    isProcessingQueue = false;
}

// Handle CSV detection
async function handleCSVDetection(csvInfo) {
    try {
        console.log('🔄 Handling CSV detection:', csvInfo.filename);
        
        // Store the detection
        lastCSVDownload = csvInfo;
        
        // Store in Chrome storage for popup access
        await chrome.storage.local.set({
            'lastCSVDownload': csvInfo
        });
        
        // Update extension badge
        chrome.action.setBadgeText({ text: '📄' });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        
        // Show notification if available
        if (chrome.notifications) {
            try {
                await chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'CSV File Detected!',
                    message: `File: ${csvInfo.filename}\nClick extension to process`
                });
            } catch (notifError) {
                console.log('Notification failed:', notifError);
            }
        }
        
        // Notify popup if open
        try {
            chrome.runtime.sendMessage({
                type: 'CSV_DETECTED',
                data: csvInfo,
                timestamp: Date.now()
            });
        } catch (messageError) {
            console.log('Popup message failed (popup likely closed)');
        }
        
        console.log('✅ CSV detection handled successfully');
        
    } catch (error) {
        console.error('❌ Failed to handle CSV detection:', error);
    }
}

// Attempt to intercept CSV content
async function interceptCSVContent(csvInfo) {
    try {
        console.log('🕷️ Attempting to intercept CSV content...');
        
        // Wait a bit for download to start
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Try to fetch content if URL is accessible
        if (csvInfo.url && !csvInfo.url.startsWith('blob:') && !csvInfo.url.startsWith('data:')) {
            try {
                console.log('📡 Fetching CSV content from URL:', csvInfo.url);
                
                const response = await fetch(csvInfo.url, {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/csv,text/plain,*/*'
                    }
                });
                
                if (response.ok) {
                    const content = await response.text();
                    
                    if (content && content.length > 0) {
                        console.log('✅ CSV content intercepted:', content.length, 'characters');
                        
                        // Update stored info with content
                        csvInfo.content = content;
                        csvInfo.contentLength = content.length;
                        
                        // Update storage
                        await chrome.storage.local.set({
                            'lastCSVDownload': csvInfo
                        });
                        
                        // Notify popup of updated content
                        try {
                            chrome.runtime.sendMessage({
                                type: 'CSV_CONTENT_READY',
                                data: csvInfo,
                                timestamp: Date.now()
                            });
                        } catch (messageError) {
                            console.log('Popup notification failed (popup likely closed)');
                        }
                        
                        return;
                    }
                }
            } catch (fetchError) {
                console.log('❌ Failed to fetch CSV content:', fetchError.message);
            }
        }
        
        console.log('ℹ️ Could not intercept content, will rely on local file');
        
    } catch (error) {
        console.error('❌ CSV interception error:', error);
    }
}

// Listen for download state changes
chrome.downloads.onChanged.addListener((downloadDelta) => {
    if (lastCSVDownload && downloadDelta.id === lastCSVDownload.downloadId) {
        console.log('📥 CSV download state changed:', downloadDelta);
        
        if (downloadDelta.state && downloadDelta.state.current === 'complete') {
            console.log('✅ CSV download completed:', lastCSVDownload.filename);
            
            lastCSVDownload.state = 'complete';
            lastCSVDownload.completedAt = Date.now();
            
            // Update storage
            chrome.storage.local.set({ 'lastCSVDownload': lastCSVDownload });
            
            // Update badge to show ready state
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#FF9800' });
            
            // If we don't have content yet, try to get it from the completed file
            if (!lastCSVDownload.content) {
                attemptContentExtractionFromCompletedDownload(lastCSVDownload);
            }
        }
    }
});

// Attempt to extract content from completed download
async function attemptContentExtractionFromCompletedDownload(csvInfo) {
    try {
        console.log('🔍 Attempting to extract content from completed download...');
        
        // Try to search for the file in the downloads folder (limited by Chrome API)
        chrome.downloads.search({ 
            id: csvInfo.downloadId 
        }, (results) => {
            if (results && results.length > 0) {
                const download = results[0];
                console.log('📁 Found download:', download);
                
                // Update CSV info with final details
                csvInfo.finalFilename = download.filename;
                csvInfo.finalUrl = download.finalUrl;
                csvInfo.totalBytes = download.totalBytes;
                
                // Store updated info
                chrome.storage.local.set({ 'lastCSVDownload': csvInfo });
                
                // Notify popup
                try {
                    chrome.runtime.sendMessage({
                        type: 'CSV_DOWNLOAD_COMPLETE',
                        data: csvInfo,
                        timestamp: Date.now()
                    });
                } catch (messageError) {
                    console.log('Popup notification failed');
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Content extraction failed:', error);
    }
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Background received message:', message.type);
    
    switch (message.type) {
        case 'GET_LAST_CSV':
            console.log('📤 Sending last CSV to popup');
            sendResponse({
                success: true,
                csv: lastCSVDownload
            });
            break;
            
        case 'CLEAR_CSV':
            console.log('🗑️ Clearing CSV detection');
            lastCSVDownload = null;
            chrome.storage.local.remove(['lastCSVDownload']);
            chrome.action.setBadgeText({ text: '' });
            sendResponse({ success: true });
            break;
            
        case 'CSV_PROCESSED':
            console.log('✅ CSV processed by popup');
            // Update badge to show processed
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
            sendResponse({ success: true });
            break;
            
        case 'CSV_UPLOADED':
            console.log('🚀 CSV uploaded successfully');
            // Clear detection and badge
            lastCSVDownload = null;
            chrome.storage.local.remove(['lastCSVDownload']);
            chrome.action.setBadgeText({ text: '' });
            sendResponse({ success: true });
            break;
            
        default:
            sendResponse({ success: false, error: 'Unknown message type' });
    }
    
    return true; // Keep message channel open for async responses
});

// Enhanced web request interception for CSV detection
if (chrome.webRequest) {
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            const url = details.url;
            
            // Check if this looks like a CSV download
            if (isCSVFile('', url, '')) {
                console.log('🕸️ Potential CSV request detected:', url);
                
                // Store for potential processing
                const csvInfo = {
                    url: url,
                    filename: extractFilenameFromUrl(url),
                    timestamp: Date.now(),
                    type: 'web_request',
                    requestId: details.requestId
                };
                
                // Add to queue for processing
                csvDetectionQueue.push(csvInfo);
                processCSVQueue();
            }
        },
        {
            urls: [
                "*://*/*csv*",
                "*://*/*export*",
                "*://*/*download*"
            ]
        }
    );
}

// Extract filename from URL
function extractFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop();
        
        if (filename && filename.length > 0) {
            return filename;
        }
        
        // Try to get from query parameters
        const params = urlObj.searchParams;
        if (params.get('filename')) {
            return params.get('filename');
        }
        
        // Default fallback
        return 'export.csv';
        
    } catch (error) {
        return 'download.csv';
    }
}

// Clear old detections periodically
setInterval(() => {
    if (lastCSVDownload && Date.now() - lastCSVDownload.timestamp > 10 * 60 * 1000) { // 10 minutes
        console.log('🧹 Clearing old CSV detection');
        lastCSVDownload = null;
        chrome.storage.local.remove(['lastCSVDownload']);
        chrome.action.setBadgeText({ text: '' });
    }
}, 60000); // Check every minute

console.log('✅ Enhanced background script ready with improved CSV detection and interception');
